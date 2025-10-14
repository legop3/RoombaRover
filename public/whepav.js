(() => {
    const video   = document.getElementById('rvVideo');
    const status  = document.getElementById('rvStatus');
    const btnPlay = document.getElementById('rvPlay');
    const btnMute = document.getElementById('rvMute');
  
    function log(msg, ...rest) {
      status.textContent = String(msg);
      console.log('[WHEP]', msg, ...rest);
    }
    function warn(msg, ...rest) {
      status.textContent = String(msg);
      console.warn('[WHEP]', msg, ...rest);
    }
    function err(msg, ...rest) {
      status.textContent = String(msg);
      console.error('[WHEP]', msg, ...rest);
    }
  
    // Debug: surface media + PC events
    ['play','pause','error','waiting','stalled','suspend','emptied','loadedmetadata','canplay','canplaythrough'].forEach(ev=>{
      video.addEventListener(ev, () => console.debug('[video]', ev, {muted: video.muted, readyState: video.readyState, paused: video.paused}));
    });
  
    class Whep {
      constructor(fetchUrl = '/video-url') {
        this.fetchUrl = fetchUrl;
        this.pc = null;
        this.aborter = null;
        this.playing = false;
        this.backoffAttempt = 0;
        this._bindUI();
      }
  
      _bindUI() {
        btnPlay.addEventListener('click', () => {
          if (!this.playing) this.start(); else this.stop();
        });
        btnMute.addEventListener('click', async () => {
          video.muted = !video.muted;
          btnMute.textContent = video.muted ? 'Unmute' : 'Mute';
          if (video.paused) { try { await video.play(); } catch(e) { err('play() blocked'); } }
        });
      }
  
      async _getWhepUrl() {
        const r = await fetch(this.fetchUrl, { cache: 'no-store' });
        if (!r.ok) throw new Error(`/video-url HTTP ${r.status}`);
        const t = (await r.text()).trim();
        if (!t || /^</.test(t)) {
          // Looks like HTML (proxy error page) — very common misconfig symptom
          throw new Error('/video-url returned HTML, check NPM subpath/rewrite');
        }
        return t; // plain string URL like https://rover.otter.land/rover-video/whep
      }
  
      async start() {
        if (this.playing) return;
        this.playing = true;
        btnPlay.textContent = 'Stop';
        this.aborter = new AbortController();
  
        try {
          const whepUrl = await this._getWhepUrl();
          log('connecting…');
  
          const pc = new RTCPeerConnection(); // MediaMTX provides ICE in SDP answer
          this.pc = pc;
  
          // Track events for visibility
          pc.oniceconnectionstatechange = () => {
            console.debug('[pc] iceState=', pc.iceConnectionState);
            if (pc.iceConnectionState === 'connected') {
              this.backoffAttempt = 0;
              log('playing');
            }
            if (['failed','disconnected'].includes(pc.iceConnectionState)) {
              warn('connection lost — reconnecting…');
              this._reconnectSoon(true);
            }
          };
          pc.onconnectionstatechange = () => console.debug('[pc] connState=', pc.connectionState);
          pc.onicegatheringstatechange = () => console.debug('[pc] gatherState=', pc.iceGatheringState);
          pc.onsignalingstatechange = () => console.debug('[pc] signaling=', pc.signalingState);
  
          pc.addTransceiver('video', { direction: 'recvonly' });
          pc.addTransceiver('audio', { direction: 'recvonly' });
  
          pc.ontrack = (ev) => {
            if (!video.srcObject) {
              video.srcObject = ev.streams[0];
              console.debug('[pc] ontrack stream attached');
            }
          };
  
          // Offer & "no-trickle" ICE
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
  
          await new Promise((resolve) => {
            if (pc.iceGatheringState === 'complete') return resolve();
            const to = setTimeout(resolve, 2000);
            pc.addEventListener('icegatheringstatechange', () => {
              if (pc.iceGatheringState === 'complete') { clearTimeout(to); resolve(); }
            });
          });
  
          // POST SDP
          const resp = await fetch(whepUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/sdp' },
            body: pc.localDescription.sdp,
            signal: this.aborter.signal
          });
          if (!resp.ok) throw new Error(`WHEP ${resp.status}`);
          const answerSdp = await resp.text();
          await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  
          // Try to start **unmuted by default**
          video.muted = false;
          try {
            await video.play();
            btnMute.textContent = 'Mute';
            log('playing');
          } catch (e) {
            // Autoplay blocked → start muted and prompt
            warn('autoplay blocked — tap Unmute');
            video.muted = true;
            btnMute.textContent = 'Unmute';
            try { await video.play(); } catch(e2) { err('play() failed: ' + e2.message); }
          }
  
        } catch (e) {
          this._teardownPeer();
          err(e.message || e);
          this._reconnectSoon(true); // refetch /video-url on next try
        }
      }
  
      async stop() {
        this.playing = false;
        btnPlay.textContent = 'Play';
        log('stopped');
        try { this.aborter?.abort(); } catch {}
        this._teardownPeer();
      }
  
      _teardownPeer() {
        try {
          if (video.srcObject) {
            video.srcObject.getTracks().forEach(t => t.stop());
            video.srcObject = null;
          }
        } catch {}
        try { this.pc?.close(); } catch {}
        this.pc = null;
      }
  
      _reconnectSoon(refetchUrl) {
        if (!this.playing) return;
        this._teardownPeer();
        const a = ++this.backoffAttempt;
        const delay = Math.min(8000, Math.floor(600 * Math.pow(1.8, a))) + Math.random()*200|0;
        log(`reconnecting in ${Math.round(delay)} ms…`);
        setTimeout(() => {
          if (!this.playing) return;
          this.start(); // start() always re-fetches /video-url at the top
        }, delay);
      }
    }
  
    // init
    const player = new Whep('/video-url');
    window.roverPlayer = player; // handy for debugging in devtools
    // Auto-start:
    player.start();
  })();