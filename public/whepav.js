(async () => {
    // 1) PICK YOUR WHEP ENDPOINT (exactly one of these):
    // If you proxied MediaMTX under /video/ with NPM:
    const WHEP_URL = "https://rovertest.otter.land/rover-video/whep";
    // Or if you’re exposing MediaMTX directly on :8889:
    // const WHEP_URL = "http://rover.otter.land:8889/rover-video/whep";
  
    const video  = document.getElementById('roverVideo');
    const status = document.getElementById('status');
    const playBtn= document.getElementById('playBtn');
    const muteBtn= document.getElementById('muteBtn');
  
    let pc = null;
    let playing = false;
  
    function log(msg){ status.textContent = msg; }
  
    async function startWhep() {
      if (playing) return;
      playing = true;
      playBtn.disabled = true;
      log("connecting…");
  
      // Create peer and request video+audio recvonly
      pc = new RTCPeerConnection({
        // ICE servers are advertised by MediaMTX in the SDP it returns; we can leave this empty here.
        // iceServers: []
      });
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });
  
      pc.ontrack = (ev) => {
        // Attach the first incoming stream
        if (!video.srcObject) video.srcObject = ev.streams[0];
      };
  
      // "No-trickle" WHEP: gather ICE, then POST a single offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
  
      // Wait for ICE gather to complete (or timeout after 2s)
      await new Promise((resolve) => {
        if (pc.iceGatheringState === "complete") return resolve();
        const timeout = setTimeout(resolve, 2000);
        pc.addEventListener("icegatheringstatechange", () => {
          if (pc.iceGatheringState === "complete") { clearTimeout(timeout); resolve(); }
        });
      });
  
      log("posting SDP…");
      const resp = await fetch(WHEP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: pc.localDescription.sdp
      });
  
      if (!resp.ok) {
        log("WHEP error " + resp.status);
        playBtn.disabled = false; playing = false;
        return;
      }
  
      const answerSdp = await resp.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      log("playing");
  
      // Try to autoplay; some browsers require a user gesture to unmute later
      try { await video.play(); } catch {}
    }
  
    function stopWhep() {
      if (pc) { pc.getSenders().forEach(s=>s.track&&s.track.stop()); pc.close(); pc = null; }
      if (video.srcObject) { video.srcObject.getTracks().forEach(t=>t.stop()); video.srcObject = null; }
      playing = false; playBtn.disabled = false; log("stopped");
    }
  
    // UI wiring
    playBtn.addEventListener("click", () => {
      if (!playing) startWhep(); else stopWhep();
      playBtn.textContent = playing ? "⏹ Stop" : "▶️ Play";
    });
  
    // Autoplay policy: we start muted; this toggles mute so you can hear audio
    muteBtn.addEventListener("click", async () => {
      video.muted = !video.muted;
      muteBtn.textContent = video.muted ? "🔇 Unmute" : "🔊 Mute";
      if (!video.paused) return;
      try { await video.play(); } catch {}
    });
  
    // Optional: auto-start (kept muted) after page load
    // startWhep();
  
    // Clean up on page unload
    window.addEventListener("beforeunload", stopWhep);
  })();