document.addEventListener('DOMContentLoaded', () => {
  const voiceSelect = document.getElementById('voice-select') as HTMLSelectElement;
  const rateSlider = document.getElementById('rate-slider') as HTMLInputElement;
  const speedLabel = document.getElementById('speed-label') as HTMLSpanElement;
  const toggleSiteBtn = document.getElementById('toggle-site-btn') as HTMLButtonElement;

  function updateSpeedLabel(val: number) {
    speedLabel.textContent = val >= 0 ? `+${val}%` : `${val}%`;
  }

  let currentDomain = '';
  let ignoredSites: string[] = [];
  let isIgnored = false;

  function updateButtonState() {
    if (!currentDomain) {
      toggleSiteBtn.textContent = 'Cannot detect site';
      toggleSiteBtn.disabled = true;
      toggleSiteBtn.style.opacity = '0.5';
      return;
    }
    
    toggleSiteBtn.disabled = false;
    toggleSiteBtn.style.opacity = '1';
    
    if (isIgnored) {
      toggleSiteBtn.textContent = `Enable on ${currentDomain}`;
      toggleSiteBtn.style.background = '#3b82f6';
      toggleSiteBtn.style.color = '#fff';
      toggleSiteBtn.style.border = '1px solid #3b82f6';
    } else {
      toggleSiteBtn.textContent = `Disable on ${currentDomain}`;
      toggleSiteBtn.style.background = '#f8fafc';
      toggleSiteBtn.style.color = '#0f172a';
      toggleSiteBtn.style.border = '1px solid #e2e8f0';
    }
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url) {
      try {
        const url = new URL(tabs[0].url);
        if (url.protocol.startsWith('http')) {
          currentDomain = url.hostname;
        }
      } catch (e) {
        // Invalid URL
      }
    }

    chrome.storage.local.get(["voice", "rate", "ignoredSites"], (result) => {
      if (result.voice) {
        voiceSelect.value = result.voice;
      }
      if (result.rate) {
        const val = result.rate[0];
        rateSlider.value = val.toString();
        updateSpeedLabel(val);
      }
      if (result.ignoredSites !== undefined) {
        ignoredSites = result.ignoredSites;
      }
      
      if (currentDomain) {
        isIgnored = ignoredSites.includes(currentDomain);
      }
      updateButtonState();
    });
  });

  voiceSelect.addEventListener('change', () => {
    chrome.storage.local.set({ voice: voiceSelect.value });
  });

  rateSlider.addEventListener('input', () => {
    const val = parseInt(rateSlider.value, 10);
    updateSpeedLabel(val);
    chrome.storage.local.set({ rate: [val] });
  });

  toggleSiteBtn.addEventListener('click', () => {
    if (!currentDomain) return;
    
    if (isIgnored) {
      ignoredSites = ignoredSites.filter(site => site !== currentDomain);
      isIgnored = false;
    } else {
      if (!ignoredSites.includes(currentDomain)) {
        ignoredSites = [...ignoredSites, currentDomain];
      }
      isIgnored = true;
    }
    
    chrome.storage.local.set({ ignoredSites }, () => {
      updateButtonState();
    });
  });
});
