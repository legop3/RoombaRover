console.log("iframeAutomation module loaded");

const iframe = document.getElementById('avFrame');

function resizeIframe() {
    // console.log('Set iframe height to body scrollHeight');
    try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        const vid = doc.querySelector('video');
        if (vid && vid.videoWidth && vid.videoHeight) {
        const ratio = vid.videoHeight / vid.videoWidth;
        iframe.style.height = iframe.offsetWidth * ratio + 'px';
        } else {
        iframe.style.height = (doc.body?.scrollHeight || 480) + 'px';
        }
    } catch (e) {
        console.warn('Cannot access iframe contents (CORS?)');
    }
}

function tryUnmute() {
    try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        const vid = doc.querySelector('video');
        if (!vid) return;

        // If it's muted, try to unmute and play
        if (vid.muted) {
        vid.muted = false;
        vid.volume = 1.0;
        }

        vid.play().then(() => {
        console.log('[iframe] video playing, unmuted =', !vid.muted);
        }).catch(err => {
        console.warn('[iframe] autoplay blocked, muting and retrying...');
        vid.muted = true;
        vid.play().catch(()=>{});
        // retry unmute every few seconds
        setTimeout(tryUnmute, 3000);
        });
    } catch (e) {
        console.warn('Cannot unmute video (CORS?)');
    }
}

iframe.addEventListener('load', () => {
    resizeIframe();
    setTimeout(resizeIframe, 4000); // adjust after video initializes
    tryUnmute();
});

window.addEventListener('resize', resizeIframe);