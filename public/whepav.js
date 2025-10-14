class WhepPlayer {
    constructor({ videoEl, statusEl, toggleBtn, muteBtn, fetchUrl = '/video-url' }) {
      this.video = videoEl;
      this.statusEl = statusEl;
      this.toggleBtn = toggleBtn;
      this.muteBtn = muteBtn;
      this.fetchUrl = fetchUrl;
  
      this.pc = null;
      this.playing = false;
      this.stopping = false;
      this.backoff = { attempt: 0, min: 500, max: 8000 }; // ms
      this.lastWhep = null;
  
      this._wireUI();
      this._wireLifecycle();
    }
  
    log(s){ if (this.statusEl) this.statusEl.textContent = s; }
  
    async _getStreamUrl() {
      const r = await fetch(this.fetchUrl, { cache: 'no-store' });
      if (!r.ok) throw new Error(`/video-url HTTP ${r.status}`);
      const text = await r.text();
      try {
        const maybe = JSON.parse(text);
        if (maybe && typeof maybe.url === 'string') return maybe.url;
      } catch {}
      return text.trim();
    }
  
    async start() {
      if (this.playing) return;
      this.stopping = false;
      this.playing = true;
      this.toggleBtn && (this.toggleBtn.textContent = 'Stop');
  
      try {
        const whepUrl = await this._getStreamUrl();
        this.lastWhep = whepUrl;
        this.log('connecting…');
  
        const pc = new RTCPeerConnection();
        this.pc = pc;
  
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });
  
        pc.ontrack = (ev) => {
          if (!this.video.srcObject) this.video.srcObject = ev.streams[0];
        };
  
        pc.oniceconnectionstatechange = () => {
          const s = pc.iceConnectionState;
          if (s === 'connected') {
            this.backoff.attempt = 0;
            this.log('playing');
          } else if (s === 'failed' || s === 'disconnected') {
            this.log('connection lost—reconnecting…');
            this._scheduleReconnect();
          }
        };
  
        // Create offer and do “no-trickle” ICE
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
  
        await new Promise((resolve) => {
          if (pc.iceGatheringState === 'complete') return resolve();
          const to = setTimeout(resolve, 2000);
          pc.addEventListener('icegatheringstatechange', () => {
            if (pc.iceGatheringState === 'complete') { clearTimeout(to); resolve(); }
          });
        });
  
        const resp = await fetch(whepUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: pc.localDescription.sdp
        });
        if (!resp.ok) throw new Error(`WHEP ${resp.status}`);
        const answer = await resp.text();
        await pc.setRemoteDescription({ type: 'answer', sdp: answer });
  
        // Try unmuted by default
        this.video.muted = false;
        try { await this.video.play(); }
        catch (e) {
          // Autoplay blocked: start muted and show “Mute” button as “Unmute”
          this.video.muted = true;
          await this.video.play().catch(()=>{});
          this.muteBtn && (this.muteBtn.textContent = 'Unmute');
          this.log('tap Unmute to enable audio');
        }
      } catch (e) {
        this.log('connect error: ' + (e?.message || e));
        this._scheduleReconnect(true);
      }
    }
  
    async stop() {
      this.stopping = true;
      this.playing = false;
      this.toggleBtn && (this.toggleBtn.textContent = 'Play');
      this.log('stopped');
      this._teardownPeer();
    }
  
    async restartSoon() {
      await this.stop();
      setTimeout(()=> this.start(), 200);
    }
  
    _teardownPeer() {
      try {
        if (this.video.srcObject) {
          this.video.srcObject.getTracks().forEach(t => t.stop());
          this.video.srcObject = null;
        }
      } catch {}
      try {
        if (this.pc) this.pc.close();
      } catch {}
      this.pc = null;
    }
  
    _scheduleReconnect(forceNewUrl = false) {
      if (this.stopping) return;
      this._teardownPeer();
  
      const attempt = ++this.backoff.attempt;
      const delay = Math.min(this.backoff.max, this.backoff.min * Math.pow(1.8, attempt));
      const jitter = Math.random() * 200;
      setTimeout(async () => {
        if (this.stopping) return;
        try {
          if (forceNewUrl) this.lastWhep = null;
          // re-fetch URL in case the server changed it
          if (!this.lastWhep) this.lastWhep = await this._getStreamUrl();
          await this.start();
        } catch (e) {
          this.log('reconnect failed—retrying…');
          this._scheduleReconnect(true);
        }
      }, delay + jitter);
    }
  
    _wireUI() {
      if (this.toggleBtn) {
        this.toggleBtn.addEventListener('click', () => {
          if (!this.playing) this.start();
          else this.stop();
        });
      }
      if (this.muteBtn) {
        this.muteBtn.addEventListener('click', async () => {
          this.video.muted = !this.video.muted;
          this.muteBtn.textContent = this.video.muted ? 'Unmute' : 'Mute';
          if (!this.video.paused) return;
          try { await this.video.play(); } catch {}
        });
      }
    }
  
    _wireLifecycle() {
      // Try to recover after network goes offline/online
      window.addEventListener('online', () => { if (this.playing) this.restartSoon(); });
      // Reconnect when tab becomes visible if it had dropped
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.playing && (!this.pc || this.pc.iceConnectionState !== 'connected')) {
          this.restartSoon();
        }
      });
      // Cleanup
      window.addEventListener('beforeunload', () => this.stop());
    }
  }
  
  // ---- boot it ----
  const video   = document.getElementById('roverVideo');
  const status  = document.getElementById('roverStatus');
  const toggle  = document.getElementById('roverToggle');
  const muteBtn = document.getElementById('roverMute');
  
  const player = new WhepPlayer({
    videoEl: video,
    statusEl: status,
    toggleBtn: toggle,
    muteBtn: muteBtn,
    fetchUrl: '/video-url'
  });
  
  // auto-start
  player.start();