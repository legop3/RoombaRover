(() => {
    const video   = document.getElementById('rvVideo');
    const status  = document.getElementById('rvStatus');
    const btnPlay = document.getElementById('rvPlay');
    const btnMute = document.getElementById('rvMute');
  
    function log(msg, ...rest){ status.textContent = String(msg); console.log('[WHEP]', msg, ...rest); }
    function warn(msg, ...rest){ status.textContent = String(msg); console.warn('[WHEP]', msg, ...rest); }
    function errorLog(msg, ...rest){ status.textContent = String(msg); console.error('[WHEP]', msg, ...rest); }
  
    // Debug video events
    ['play','pause','error','waiting','stalled','suspend','emptied','loadedmetadata','canplay','canplaythrough','timeupdate']
      .forEach(ev => video.addEventListener(ev, () => console.debug('[video]', ev, {muted: video.muted, rs: video.readyState, paused: video.paused})));
  
    class WHEPPlayer {
      constructor(fetchUrl='/video-url'){
        this.fetchUrl = fetchUrl;
        this.pc = null;
        this.controller = null;
        this.playing = false;
        this.backoff = 0;
        this.discoTimer = null;     // ICE disconnect grace timer
        this.statsTimer = null;     // inbound-rtp watchdog
        this.bytesLast = 0;
        this.statsStalls = 0;
  
        this._wireUI();
        this._wireLifecycle();
      }
  
      _wireUI(){
        btnPlay.addEventListener('click', () => this.playing ? this.stop() : this.start());
        btnMute.addEventListener('click', async () => {
          video.muted = !video.muted;
          btnMute.textContent = video.muted ? 'Unmute' : 'Mute';
          if (video.paused) { try { await video.play(); } catch(e) {} }
        });
      }
  
      _wireLifecycle(){
        window.addEventListener('online', () => { if (this.playing) this._restartSoon(); });
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible' && this.playing) this._restartSoon();
        });
        window.addEventListener('beforeunload', () => this.stop());
      }
  
      async _getUrl(){
        const r = await fetch(this.fetchUrl, { cache: 'no-store' });
        const t = (await r.text()).trim();
        if (!r.ok || !t || /^</.test(t)) throw new Error(`/video-url bad response`);
        return t;
      }
  
      async start(){
        if (this.playing) return;
        this.playing = true;
        btnPlay.textContent = 'Stop';
        this.controller = new AbortController();
  
        try {
          const url = await this._getUrl();
          log('connecting…');
  
          const pc = new RTCPeerConnection();
          this.pc = pc;
  
          pc.addTransceiver('video', { direction:'recvonly' });
          pc.addTransceiver('audio', { direction:'recvonly' });
  
          pc.ontrack = (e) => {
            if (!video.srcObject) {
              video.srcObject = e.streams[0];
              console.debug('[pc] stream attached');
            }
          };
  
          pc.oniceconnectionstatechange = () => {
            const s = pc.iceConnectionState;
            console.debug('[pc] ice=', s);
            if (s === 'connected') {
              this.backoff = 0;
              this._clearDiscoTimer();
              this._startStatsWatch();
              log('playing');
            } else if (s === 'disconnected' || s === 'failed') {
              // Grace period: browsers often bounce to 'disconnected' briefly
              this._startDiscoTimer();
            }
          };
  
          pc.onconnectionstatechange = () => console.debug('[pc] state=', pc.connectionState);
  
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
  
          await new Promise(res => {
            if (pc.iceGatheringState === 'complete') return res();
            const to = setTimeout(res, 2000);
            pc.addEventListener('icegatheringstatechange', () => {
              if (pc.iceGatheringState === 'complete') { clearTimeout(to); res(); }
            });
          });
  
          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/sdp' },
            body: pc.localDescription.sdp,
            signal: this.controller.signal
          });
          if (!resp.ok) throw new Error(`WHEP ${resp.status}`);
          const answer = await resp.text();
          await pc.setRemoteDescription({ type:'answer', sdp: answer });
  
          // Try to autoplay UNMUTED
          video.muted = false;
          try { await video.play(); btnMute.textContent = 'Mute'; }
          catch (e) {
            warn('autoplay blocked — starting muted');
            video.muted = true; btnMute.textContent = 'Unmute';
            try { await video.play(); } catch {}
          }
  
        } catch (e) {
          errorLog(e && e.message || e);
          this._scheduleReconnect();
        }
      }
  
      async stop(){
        this.playing = false;
        btnPlay.textContent = 'Play';
        log('stopped');
        this._teardown();
      }
  
      _teardown(){
        this._clearDiscoTimer();
        this._stopStatsWatch();
        try { this.controller?.abort(); } catch {}
        try {
          if (video.srcObject) {
            video.srcObject.getTracks().forEach(t => t.stop());
            video.srcObject = null;
          }
        } catch {}
        try { this.pc?.close(); } catch {}
        this.pc = null;
      }
  
      _startDiscoTimer(){
        if (this.discoTimer) return;
        this.discoTimer = setTimeout(() => {
          this.discoTimer = null;
          warn('connection lost — reconnecting…');
          this._scheduleReconnect();
        }, 2000); // 2s grace
      }
      _clearDiscoTimer(){
        if (this.discoTimer) { clearTimeout(this.discoTimer); this.discoTimer = null; }
      }
  
      _startStatsWatch(){
        this._stopStatsWatch();
        this.bytesLast = 0;
        this.statsStalls = 0;
  
        const poll = async () => {
          if (!this.pc) return;
          try {
            let bytes = 0;
            const stats = await this.pc.getStats(null);
            stats.forEach(r => {
              if (r.type === 'inbound-rtp' && !r.isRemote) bytes += (r.bytesReceived||0);
            });
            if (bytes <= this.bytesLast) {
              this.statsStalls++;
              if (this.statsStalls >= 5) { // ~5 seconds of no progress
                warn('no media bytes — restarting…');
                this._restartSoon();
                return;
              }
            } else {
              this.statsStalls = 0;
            }
            this.bytesLast = bytes;
          } catch {}
          this.statsTimer = setTimeout(poll, 1000);
        };
        poll();
      }
      _stopStatsWatch(){
        if (this.statsTimer) { clearTimeout(this.statsTimer); this.statsTimer = null; }
      }
  
      _restartSoon(){
        if (!this.playing) return;
        this._teardown();
        setTimeout(() => { if (this.playing) this.start(); }, 300);
      }
  
      _scheduleReconnect(){
        if (!this.playing) return;
        this._teardown();
        this.backoff = Math.min(8000, (this.backoff||600) * 1.8);
        const delay = Math.round((this.backoff||600) + Math.random()*250);
        log(`reconnecting in ${delay}ms…`);
        setTimeout(() => { if (this.playing) this.start(); }, delay);
      }
    }
  
    const player = new WHEPPlayer('/video-url');
    window.roverPlayer = player;
    player.start();
  })();