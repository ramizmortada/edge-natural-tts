document.addEventListener('DOMContentLoaded', () => {
  const voiceSelect = document.getElementById('voice-select') as HTMLSelectElement;
  const rateSlider = document.getElementById('rate-slider') as HTMLInputElement;
  const speedLabel = document.getElementById('speed-label') as HTMLSpanElement;

  function updateSpeedLabel(val: number) {
    speedLabel.textContent = val >= 0 ? `+${val}%` : `${val}%`;
  }

  // Load saved preferences
  chrome.storage.local.get(["voice", "rate"], (result) => {
    if (result.voice) {
      voiceSelect.value = result.voice;
    }
    if (result.rate) {
      const val = result.rate[0];
      rateSlider.value = val.toString();
      updateSpeedLabel(val);
    }
  });

  // Save on change
  voiceSelect.addEventListener('change', () => {
    chrome.storage.local.set({ voice: voiceSelect.value });
  });

  rateSlider.addEventListener('input', () => {
    const val = parseInt(rateSlider.value, 10);
    updateSpeedLabel(val);
    chrome.storage.local.set({ rate: [val] });
  });
});
