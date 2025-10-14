(() => {
    const video   = document.getElementById('rvVideo');
    const btnPlay = document.getElementById('rvStart');
    const btnMute = document.getElementById('rvMute');
    const status  = document.getElementById('rvStatus');
  
    const log  = (m,...a)=>{ status.textContent = m; console.log('[WHEP]', m, ...a); };
    const warn = (m,...a)=>{ status.textContent = m; console.warn('[WHEP]', m, ...a); };
    const err  = (m,...a)=>{ status.textContent = m; console.error('[WHEP]', m, ...a); };
  
    // Helpful video event logging
    ['play','pause','error','waiting','loadedmetadata','canplay','emptied','stalled','suspend']
      .forEach(ev => video.addEventListener(ev, ()=>console.debug('[video]', ev, {muted: video.muted, rs: video.readyState, paused: video.paused})));
  
    let pc = null;
    let aborter = null;
    let playing = false;
    let reconnectTimer = null;
    let iceDiscoTimer = null;
  
    function clearTimers(){
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (iceDiscoTimer)  { clearTimeout(iceDiscoTimer);  iceDiscoTimer = null; }
    }
  
    async function getWhepUrl() {
      const r = await fetch('/video-url', { cache: 'no-store' });
      const t = (await r.text()).trim();
      if (!r.ok || !t) throw new Error('/video-url bad response');
      if (/^</.test(t)) throw new Error('/video-url returned HTML (proxying wrong path?)');
      return t; // e.g. https://rover.otter.land/rover-video/whep
    }
  
    async function start() {
      if (playing) return;
      playing = true;
      btnPlay.textContent = 'Stop';
      clearTimers();
  
      try {
        const url = await getWhepUrl();
        log('connecting…');
  
        aborter = new AbortController();
        pc = new RTCPeerConnection();
  
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });
  
        pc.ontrack = (ev) => {
          if (!video.srcObject) {
            video.srcObject = ev.streams[0];
            console.debug('[pc] stream attached');
          }
        };
  
        pc.oniceconnectionstatechange = () => {
          const s = pc.iceConnectionState;
          console.debug('[pc] ice=', s);
          if (s === 'connected') {
            if (iceDiscoTimer) { clearTimeout(iceDiscoTimer); iceDiscoTimer = null; }
            log('playing');
          } else if (s === 'disconnected' || s === 'failed') {
            // give it a moment—pages with lots going on can flap briefly
            if (!iceDiscoTimer) {
              iceDiscoTimer = setTimeout(() => {
                iceDiscoTimer = null;
                warn('connection lost — reconnecting…');
                reconnectSoon();
              }, 2500);
            }
          }
        };
  
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
  
        // "no trickle": wait for gather complete (or 3s max)
        await new Promise(res => {
          if (pc.iceGatheringState === 'complete') return res();
          const to = setTimeout(res, 3000);
          pc.addEventListener('icegatheringstatechange', () => {
            if (pc.iceGatheringState === 'complete') { clearTimeout(to); res(); }
          });
        });
  
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: pc.localDescription.sdp,
          signal: aborter.signal
        });
        if (!resp.ok) throw new Error(`WHEP ${resp.status}`);
        const answer = await resp.text();
  
        // sanity check: must have m=video
        if (!/^\s*m=video\s/im.test(answer)) {
          throw new Error('answer SDP missing video m-line');
        }
  
        await pc.setRemoteDescription({ type: 'answer', sdp: answer });
  
        // try UNMUTED first (what you want)
        video.muted = false;
        try {
          await video.play();
          btnMute.textContent = 'Mute';
        } catch (e) {
          // autoplay policy: flip to muted but keep going
          warn('autoplay blocked — starting muted');
          video.muted = true;
          btnMute.textContent = 'Unmute';
          try { await video.play(); } catch {}
        }
  
      } catch (e) {
        err(e.message || e);
        reconnectSoon(true);
      }
    }
  
    function stop() {
      playing = false;
      btnPlay.textContent = 'Play';
      clearTimers();
      try { aborter?.abort(); } catch {}
      try { pc?.close(); } catch {}
      pc = null;
      aborter = null;
      try {
        if (video.srcObject) {
          video.srcObject.getTracks().forEach(t=>t.stop());
          video.srcObject = null;
        }
      } catch {}
      log('stopped');
    }
  
    function reconnectSoon(resetBackoff) {
      if (!playing) return;
      stop(); // full teardown like the version that worked for you
      const delay = 800; // small, fixed delay (kept simple because your old flow worked)
      reconnectTimer = setTimeout(() => { if (playing) start(); else start(); }, delay);
    }
  
    // UI
    btnPlay.addEventListener('click', () => { playing ? stop() : start(); });
    btnMute.addEventListener('click', async () => {
      video.muted = !video.muted;
      btnMute.textContent = video.muted ? 'Unmute' : 'Mute';
      if (video.paused) { try { await video.play(); } catch {} }
    });
    window.addEventListener('beforeunload', stop);
  
    // Auto-start immediately (like the original that worked)
    start();
  
    // Expose for quick manual restarts in console
    window.__whep = { start, stop };
  })();