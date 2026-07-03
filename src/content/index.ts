import { Communicate } from "edge-tts-universal/browser";

let isPlaying = false;
let isLoading = false;
let currentAudioTime = 0;
let currentTarget: HTMLElement | null = null;
let hoverTimer: any = null;
let syncInterval: any = null;
let activeHighlightName = "edge-tts-highlight";
let currentTextNode: Node | null = null;
let isSiteIgnored = false;

function checkIgnoredSites(ignoredSites: string[]) {
  const currentUrl = window.location.href;
  const currentDomain = window.location.hostname;
  isSiteIgnored = ignoredSites.some((site: string) => {
    return currentUrl.includes(site) || currentDomain.includes(site);
  });
  
  if (isSiteIgnored) {
    if (typeof stopSession === 'function') stopSession();
    if (typeof playButton !== 'undefined') playButton.style.display = 'none';
    if (typeof floatingBar !== 'undefined') floatingBar.style.display = 'none';
  } else {
    if (typeof playButton !== 'undefined') playButton.style.display = 'flex';
    if (typeof floatingBar !== 'undefined') floatingBar.style.display = 'flex';
  }
}

try {
  chrome.storage.local.get(["ignoredSites"], (result) => {
    checkIgnoredSites(result.ignoredSites || []);
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.ignoredSites) {
      checkIgnoredSites(changes.ignoredSites.newValue || []);
    }
  });
} catch (e) {}

// Inject highlight styles
const style = document.createElement("style");
style.textContent = `
  ::highlight(${activeHighlightName}) {
    background-color: rgba(59, 130, 246, 0.4);
    color: inherit;
    border-radius: 3px;
  }
  ::highlight(aura-sentence-hover) {
    background-color: rgba(250, 204, 21, 0.4);
    cursor: pointer;
  }
`;
document.head.appendChild(style);

const VALID_TAGS = new Set(["P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "SPAN", "A", "TD", "TH", "ARTICLE", "DIV", "FIGCAPTION"]);

function isValidTextElement(el: HTMLElement): boolean {
  if (!el || !el.tagName) return false;
  if (!VALID_TAGS.has(el.tagName)) return false;

  const role = el.getAttribute("role");
  if (role && ["button", "menuitem", "tab", "dialog", "navigation", "search", "switch", "checkbox", "radio", "option"].includes(role)) return false;

  let depth = 0;
  let currentEl: HTMLElement | null = el;
  const uiClasses = ["btn", "button", "dropdown", "menu", "nav", "tab", "pill", "badge", "tag", "filter", "pagination", "controls", "profile", "avatar", "author", "metadata"];
  while (currentEl && currentEl !== document.body && currentEl !== document.documentElement && depth < 4) {
    const classes = currentEl.classList;
    for (let i = 0; i < classes.length; i++) {
      const cls = classes[i].toLowerCase();
      if (uiClasses.some(ui => cls === ui || cls.includes(`-${ui}`) || cls.includes(`${ui}-`))) {
        return false;
      }
    }
    currentEl = currentEl.parentElement;
    depth++;
  }

  if (el.closest("nav, footer, aside, menu, form, button, [role='navigation'], [role='menu'], [role='tablist'], [role='search'], [role='toolbar'], [role='menubar'], [role='dialog'], [role='button'], [role='tab']")) {
    return false;
  }
  
  if (el.tagName === "DIV") {
    const hasBlockChildren = Array.from(el.children).some(child => {
      const tag = child.tagName;
      return ["DIV", "P", "UL", "OL", "TABLE", "SECTION", "ARTICLE", "HEADER", "FOOTER", "BLOCKQUOTE"].includes(tag);
    });
    if (hasBlockChildren) return false;
  }

  const text = el.innerText || el.textContent || "";
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;

  const rect = el.getBoundingClientRect();
  if (rect.height > 600) return false;

  const wordCount = trimmed.split(/\s+/).length;
  if (!["H1", "H2", "H3", "H4", "H5", "H6", "P", "LI", "BLOCKQUOTE", "TH", "TD"].includes(el.tagName)) {
    if (wordCount <= 5) {
      const hasPunctuation = /[.!?:]/.test(trimmed);
      if (!hasPunctuation) return false;
    }
    if (rect.height > 150 && wordCount < 15) {
      return false;
    }
  }
  
  if (["DIV", "SPAN", "ARTICLE", "SECTION", "LI"].includes(el.tagName)) {
    const interactiveElements = Array.from(el.querySelectorAll("a, button"));
    let interactiveTextLength = 0;
    for (const child of interactiveElements) {
      interactiveTextLength += (child.innerText || child.textContent || "").length;
    }
    if (interactiveTextLength > 0 && interactiveTextLength >= trimmed.length * 0.5) {
      return false;
    }
  }

  const mediaElements = Array.from(el.querySelectorAll("img, video, svg"));
  let totalMediaArea = 0;
  for (const media of mediaElements) {
    const mediaRect = media.getBoundingClientRect();
    totalMediaArea += mediaRect.width * mediaRect.height;
  }
  const elArea = rect.width * rect.height;
  if (elArea > 0 && totalMediaArea > elArea * 0.5) {
    return false;
  }

  return true;
}

function getClosestValidElement(el: HTMLElement | null): HTMLElement | null {
  let current = el;
  let highestValid: HTMLElement | null = null;
  while (current && current !== document.body && current !== document.documentElement) {
    if (isValidTextElement(current)) {
      highestValid = current;
    } else if (highestValid) {
      break;
    }
    current = current.parentElement;
  }
  return highestValid;
}

function getNextValidElement(current: HTMLElement): HTMLElement | null {
  let node: Node | null = current;
  function getNextNode(n: Node): Node | null {
    if (n !== current && n.firstChild) return n.firstChild;
    while (n) {
      if (n.nextSibling) return n.nextSibling;
      n = n.parentNode as Node;
    }
    return null;
  }

  while ((node = getNextNode(node))) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (isValidTextElement(el)) {
        return el;
      }
    }
  }
  return null;
}

function extractRawText(el: HTMLElement): string {
  let text = "";
  function traverse(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || "";
    } else {
      for (const child of Array.from(node.childNodes)) {
        traverse(child);
      }
    }
  }
  traverse(el);
  return text;
}

function createRangeFromOffset(el: HTMLElement, start: number, length: number): Range | null {
  const range = document.createRange();
  let currentOffset = 0;
  let startNode: Node | null = null;
  let startNodeOffset = 0;
  let endNode: Node | null = null;
  let endNodeOffset = 0;

  function traverse(node: Node) {
    if (endNode) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const nodeLen = node.textContent?.length || 0;
      if (!startNode && currentOffset + nodeLen > start) {
        startNode = node;
        startNodeOffset = start - currentOffset;
      }
      if (startNode && currentOffset + nodeLen >= start + length) {
        endNode = node;
        endNodeOffset = start + length - currentOffset;
      }
      currentOffset += nodeLen;
    } else {
      for (const child of Array.from(node.childNodes)) {
        traverse(child);
      }
    }
  }

  traverse(el);

  if (startNode && endNode) {
    try {
      range.setStart(startNode, startNodeOffset);
      range.setEnd(endNode, endNodeOffset);
      return range;
    } catch (e) {
      return null;
    }
  }
  return null;
}

const PLAY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
const PAUSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
const LOAD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>`;

const playButton = document.createElement("button");
playButton.id = "edge-tts-hover-play";
playButton.innerHTML = PLAY_SVG;
playButton.style.position = "absolute";
playButton.style.zIndex = "2147483647"; 
playButton.style.background = "#2563eb";
playButton.style.color = "white";
playButton.style.border = "none";
playButton.style.borderRadius = "50%";
playButton.style.width = "20px";
playButton.style.height = "20px";
playButton.style.display = "flex";
playButton.style.alignItems = "center";
playButton.style.justifyContent = "center";
playButton.style.cursor = "pointer";
playButton.style.boxShadow = "0 4px 12px rgba(37, 99, 235, 0.4)";
playButton.style.opacity = "0";
playButton.style.pointerEvents = "none";
  playButton.style.transition = "opacity 0.15s ease, background 0.2s";

document.body.appendChild(playButton);

const floatingBar = document.createElement("div");
floatingBar.id = "edge-tts-floating-bar";
Object.assign(floatingBar.style, {
  position: "fixed",
  top: "50%",
  right: "20px",
  transform: "translateY(-50%) translateX(100px)",
  backgroundColor: "rgba(15, 23, 42, 0.8)",
  backdropFilter: "blur(8px)",
  border: "1px solid rgba(255, 255, 255, 0.1)",
  borderRadius: "12px",
  padding: "8px",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  zIndex: "2147483647",
  transition: "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s",
  opacity: "0",
  pointerEvents: "none",
  boxShadow: "0 10px 25px rgba(0, 0, 0, 0.3)"
});

const globalPlayPauseButton = document.createElement("button");
Object.assign(globalPlayPauseButton.style, {
  width: "36px",
  height: "36px",
  borderRadius: "8px",
  border: "none",
  backgroundColor: "rgba(37, 99, 235, 0.2)",
  color: "#3b82f6",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  transition: "background-color 0.2s"
});
globalPlayPauseButton.onmouseenter = () => globalPlayPauseButton.style.backgroundColor = "rgba(37, 99, 235, 0.4)";
globalPlayPauseButton.onmouseleave = () => globalPlayPauseButton.style.backgroundColor = "rgba(37, 99, 235, 0.2)";

function updateGlobalPlayPauseIcon() {
  if (isPlaying) {
    globalPlayPauseButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
  } else {
    globalPlayPauseButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
  }
}
updateGlobalPlayPauseIcon();

function setPlaying(val: boolean) {
  isPlaying = val;
  updateGlobalPlayPauseIcon();
}

globalPlayPauseButton.onclick = () => {
  if (isPlaying && activePort) {
    activePort.postMessage({ type: "PAUSE" });
    setPlaying(false);
    clearHighlight(false);
    if (currentTarget === activeTarget) {
      playButton.innerHTML = PLAY_SVG;
      playButton.style.background = "#2563eb";
    }
  } else if (!isPlaying && activePort && activeTarget !== null) {
    activePort.postMessage({ type: "PLAY" });
    setPlaying(true);
    if (currentTarget === activeTarget) {
      playButton.innerHTML = PAUSE_SVG;
      playButton.style.background = "#ef4444";
    }
  }
};
floatingBar.appendChild(globalPlayPauseButton);


const stopButton = document.createElement("button");
stopButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" ry="2"></rect></svg>`;
Object.assign(stopButton.style, {
  width: "36px",
  height: "36px",
  borderRadius: "8px",
  border: "none",
  backgroundColor: "rgba(239, 68, 68, 0.2)",
  color: "#ef4444",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  transition: "background-color 0.2s"
});
stopButton.onmouseenter = () => stopButton.style.backgroundColor = "rgba(239, 68, 68, 0.4)";
stopButton.onmouseleave = () => stopButton.style.backgroundColor = "rgba(239, 68, 68, 0.2)";

stopButton.onclick = () => {
  stopSession();
};

floatingBar.appendChild(stopButton);
document.body.appendChild(floatingBar);

function stopSession() {
  if (activePort) {
     activePort.postMessage({ type: "STOP" });
  }
  if (activePort) {
     activePort.disconnect();
     activePort = null;
  }
  setPlaying(false);
  isLoading = false;
  activeTarget = null;
  clearHighlight(true);
  clearSentenceHover();
  
  floatingBar.style.transform = "translateY(-50%) translateX(100px)";
  floatingBar.style.opacity = "0";
  floatingBar.style.pointerEvents = "none";
  
  if (currentTarget) {
     updatePlayButtonAppearance();
  } else {
     playButton.style.opacity = "0";
     playButton.style.pointerEvents = "none";
  }
}

function startSession() {
  floatingBar.style.transform = "translateY(-50%) translateX(0)";
  floatingBar.style.opacity = "1";
  floatingBar.style.pointerEvents = "auto";
}

function syncPosition() {
  if (!currentTarget) return;
  
  let rect: DOMRect;
  if (currentTextNode) {
    const range = document.createRange();
    range.selectNodeContents(currentTextNode);
    rect = range.getBoundingClientRect();
  } else {
    rect = currentTarget.getBoundingClientRect();
  }

  const top = rect.top + window.scrollY;
  const left = rect.left + window.scrollX - 24;
  
  playButton.style.top = `${top}px`;
  playButton.style.left = `${left}px`;
}

function updatePlayButtonAppearance() {
  if (isLoading) return;
  if (isPlaying && currentTarget === activeTarget && activeTarget !== null) {
    playButton.innerHTML = PAUSE_SVG;
    playButton.style.background = "#ef4444";
  } else {
    playButton.innerHTML = PLAY_SVG;
    playButton.style.background = "#2563eb";
  }
}

let activeTarget: HTMLElement | null = null;
let activePort: chrome.runtime.Port | null = null;
let currentHighlightTick: any = null;
let activeFullText = "";
let activeWordBoundaries: any[] = [];
let hoveredAudioOffset: number | null = null;
let lastSentenceStart = -1;
const sentenceHighlightName = "aura-sentence-hover";
let hoveredValidEl: HTMLElement | null = null;
let hoveredSentenceStart = 0;
let pendingSeekCharOffset: number | null = null;
function clearHighlight(stopTimer = true) {
  if (stopTimer && currentHighlightTick) {
    clearInterval(currentHighlightTick);
    currentHighlightTick = null;
  }
  if ('highlights' in CSS) {
    (CSS as any).highlights.delete(activeHighlightName);
  }
}

function clearSentenceHover() {
  if ('highlights' in CSS) (CSS as any).highlights.delete(sentenceHighlightName);
  hoveredAudioOffset = null;
  lastSentenceStart = -1;
  if (hoveredValidEl) {
     hoveredValidEl.style.cursor = "";
     hoveredValidEl = null;
  }
}

function handleSentenceHover(e: MouseEvent, validEl: HTMLElement) {
  const range = (document as any).caretRangeFromPoint(e.clientX, e.clientY);
  if (!range) return;

  const textNode = range.startContainer;
  const offsetInNode = range.startOffset;
  if (textNode.nodeType !== Node.TEXT_NODE) return;

  let absoluteOffset = 0;
  let found = false;

  function traverse(node: Node) {
    if (found) return;
    if (node === textNode) {
      absoluteOffset += offsetInNode;
      found = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      absoluteOffset += node.textContent?.length || 0;
    } else {
      for (const child of Array.from(node.childNodes)) {
        traverse(child);
      }
    }
  }
  traverse(validEl);
  if (!found) return;

  const text = (validEl === activeTarget) ? activeFullText : extractRawText(validEl);
  let sentenceStart = 0;
  let sentenceEnd = text.length;

  for (let i = absoluteOffset; i >= 0; i--) {
     if (i === 0) { sentenceStart = 0; break; }
     if ((text[i] === '.' || text[i] === '?' || text[i] === '!') && (text[i+1] === ' ' || text[i+1] === '\n')) {
         sentenceStart = i + 2;
         break;
     }
     if (text[i] === '\n') {
         sentenceStart = i + 1;
         break;
     }
  }

  for (let i = absoluteOffset; i < text.length; i++) {
     if ((text[i] === '.' || text[i] === '?' || text[i] === '!') && (i === text.length - 1 || text[i+1] === ' ' || text[i+1] === '\n')) {
         sentenceEnd = i + 1;
         break;
     }
     if (text[i] === '\n') {
         sentenceEnd = i;
         break;
     }
  }

  if (sentenceStart === lastSentenceStart && hoveredValidEl === validEl) return;
  lastSentenceStart = sentenceStart;
  
  if (hoveredValidEl && hoveredValidEl !== validEl) {
     hoveredValidEl.style.cursor = "";
  }
  hoveredValidEl = validEl;

  if (sentenceEnd > sentenceStart) {
      const highlightRange = createRangeFromOffset(validEl, sentenceStart, sentenceEnd - sentenceStart);
      if (highlightRange && 'highlights' in CSS) {
         const highlight = new (window as any).Highlight(highlightRange);
         (CSS as any).highlights.set(sentenceHighlightName, highlight);
         validEl.style.cursor = "pointer";
      }
      
      hoveredSentenceStart = sentenceStart;
      if (validEl === activeTarget && isPlaying) {
         const firstWord = activeWordBoundaries.find(w => w.charOffset >= sentenceStart);
         if (firstWord) {
            hoveredAudioOffset = firstWord.audioOffsetMs;
         } else {
            hoveredAudioOffset = null;
         }
      } else {
         hoveredAudioOffset = null;
      }
  }
}

document.addEventListener("click", (e) => {
  if (isSiteIgnored) return;
  const target = e.target as HTMLElement;
  if (target === playButton || playButton.contains(target) || floatingBar.contains(target) || globalPlayPauseButton.contains(target)) return;

  const selection = window.getSelection();
  if (selection && selection.toString().trim().length > 0) {
    return;
  }

  if (hoveredValidEl && activeTarget !== null) {
     e.preventDefault();
     e.stopPropagation();

     if (hoveredValidEl === activeTarget && isPlaying && hoveredAudioOffset !== null && activePort) {
        activePort.postMessage({ type: "SEEK", offset: hoveredAudioOffset / 1000 });
     } else {
        pendingSeekCharOffset = hoveredSentenceStart;
        currentTarget = hoveredValidEl;
        if (playButton.onclick) {
           playButton.onclick(null as any);
        }
     }
  }
}, true);

document.addEventListener("mousemove", (e) => {
  if (isSiteIgnored) return;
  if (isLoading) return;

  const target = e.target as HTMLElement;
  const validEl = getClosestValidElement(target);
  
  if (target === playButton || playButton.contains(target)) {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    clearSentenceHover();
    return;
  }

  if (validEl) {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    
    if (activeTarget !== null) {
      handleSentenceHover(e, validEl);
    } else {
      clearSentenceHover();
    }
    
    if (currentTarget !== validEl) {
      // Prevent jumping to an ancestor container when traversing padding
      if (currentTarget && validEl.contains(currentTarget)) {
        // Keep current target locked
      } else {
        currentTarget = validEl;
        
        currentTextNode = null;
        const walker = document.createTreeWalker(currentTarget, NodeFilter.SHOW_TEXT, null);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if (node.textContent && node.textContent.trim().length > 0) {
            currentTextNode = node;
            break;
          }
        }

        syncPosition();
        
        if (!syncInterval) {
          syncInterval = setInterval(syncPosition, 50); 
        }
        updatePlayButtonAppearance();
      }
    }
    
    playButton.style.opacity = "1";
    playButton.style.pointerEvents = "auto";
  } else {
    clearSentenceHover();
    if (!hoverTimer) {
      hoverTimer = setTimeout(() => {
        if (!isPlaying && !isLoading) {
          playButton.style.opacity = "0";
          playButton.style.pointerEvents = "none";
          currentTarget = null;
          if (syncInterval) {
            clearInterval(syncInterval);
            syncInterval = null;
          }
        }
        hoverTimer = null;
      }, 400); 
    }
  }
});
function isExtensionValid(): boolean {
  try {
    return !!(typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

playButton.onclick = async (e: any, forceTarget?: HTMLElement) => {
  if (!isExtensionValid()) {
    alert("Edge Natural TTS: The extension was updated or reloaded. Please refresh the page to continue.");
    return;
  }

  if (e) {
    if (e.stopPropagation) e.stopPropagation();
    if (e.preventDefault) e.preventDefault();
  }

  const targetToPlay = forceTarget || currentTarget;

  if (isPlaying) {
    if (targetToPlay === activeTarget) {
      if (activePort) activePort.postMessage({ type: "PAUSE" });
      setPlaying(false);
      clearHighlight(false);
      playButton.innerHTML = PLAY_SVG;
      playButton.style.background = "#2563eb";
      return;
    } else {
      if (activePort) {
        activePort.postMessage({ type: "STOP" });
        activePort.disconnect();
        activePort = null;
      }
      setPlaying(false);
      clearHighlight(true);
    }
  }

  if (!isPlaying && targetToPlay === activeTarget && activeTarget !== null) {
    if (activePort) {
      activePort.postMessage({ type: "PLAY" });
    }
    setPlaying(true);
    playButton.innerHTML = PAUSE_SVG;
    playButton.style.background = "#ef4444";
    return;
  }

  if (isLoading || !targetToPlay) return;

  const fullTextToRead = extractRawText(targetToPlay);
  if (!fullTextToRead || !fullTextToRead.trim()) return;

  isLoading = true;
  activeTarget = targetToPlay;
  startSession();
  playButton.innerHTML = LOAD_SVG;
  playButton.children[0].animate([{transform: 'rotate(0deg)'}, {transform: 'rotate(360deg)'}], {duration: 1000, iterations: Infinity});
  playButton.style.background = "#475569"; 
  clearHighlight();

  currentAudioTime = 0;

  try {
    chrome.storage.local.get(["voice", "rate"], async (result) => {
     try {
      const voice = (result.voice as string) || "en-US-AriaNeural";
      const rateArray = (result.rate as number[]) || [0];
      const rateString = rateArray[0] >= 0 ? `+${rateArray[0]}%` : `${rateArray[0]}%`;

      let isFirstChunk = true;
      activeWordBoundaries = [];
      activeFullText = fullTextToRead;
      let lastCharOffset = 0;

      const handlePlaybackEnded = () => {
        isLoading = false;
        setPlaying(false);
        clearHighlight();
        playButton.innerHTML = PLAY_SVG;
        playButton.style.background = "#2563eb";
        
        const nextEl = getNextValidElement(activeTarget!);
        if (nextEl) {
          currentTarget = nextEl;
          currentTextNode = null;
          const walker = document.createTreeWalker(currentTarget, NodeFilter.SHOW_TEXT, null);
          let node: Node | null;
          while ((node = walker.nextNode())) {
            if (node.textContent && node.textContent.trim().length > 0) {
              currentTextNode = node;
              break;
            }
          }
          syncPosition();
          setTimeout(() => {
            if (playButton.onclick) {
              (playButton.onclick as any)(null, nextEl);
            }
          }, 100);
        } else {
          stopSession();
        }
      };

      let lastHighlightedWord: any = null;

      if (currentHighlightTick) clearInterval(currentHighlightTick);
      currentHighlightTick = setInterval(() => {
        if (!isPlaying) return;
        const currentTimeMs = currentAudioTime * 1000;
        
        const currentWord = activeWordBoundaries.find(w => 
          currentTimeMs >= w.audioOffsetMs && 
          currentTimeMs <= (w.audioOffsetMs + w.durationMs)
        );

        if (currentWord && activeTarget && 'highlights' in CSS) {
          if (currentWord !== lastHighlightedWord) {
            lastHighlightedWord = currentWord;
            const range = createRangeFromOffset(activeTarget, currentWord.charOffset, currentWord.charLength);
            if (range) {
              const highlight = new (window as any).Highlight(range);
              (CSS as any).highlights.set(activeHighlightName, highlight);
            }
          }
        } else if (!currentWord && lastHighlightedWord && 'highlights' in CSS) {
          lastHighlightedWord = null;
          (CSS as any).highlights.delete(activeHighlightName);
        }
      }, 50);

      if (!isExtensionValid()) {
        stopSession();
        alert("Edge Natural TTS: The extension was updated or reloaded. Please refresh the page.");
        return;
      }
      activePort = chrome.runtime.connect({ name: "tts-stream" });
      activePort.postMessage({
        type: "START",
        text: fullTextToRead,
        voice,
        rateString
      });

      activePort.onMessage.addListener((msg) => {
        if (!isLoading && !isPlaying) {
           try { activePort?.disconnect(); } catch {}
           activePort = null;
           return;
        }

        if (msg.type === "TIME_UPDATE") {
          currentAudioTime = msg.currentTime;
          if (isFirstChunk) {
            isFirstChunk = false;
            isLoading = false;
            setPlaying(true);
            playButton.innerHTML = PAUSE_SVG;
            playButton.style.background = "#ef4444"; 
          }
        } else if (msg.type === "PLAYBACK_ENDED") {
          handlePlaybackEnded();
        } else if (msg.type === "WordBoundary") {
          if (msg.offset !== undefined) {
             const audioOffsetMs = msg.offset / 10000;
             const durationMs = msg.duration / 10000;
             const wordStr = msg.textObj || "";
             if (wordStr.length > 0) {
                const charOffset = fullTextToRead.indexOf(wordStr, lastCharOffset);
                if (charOffset !== -1) {
                  const charLength = wordStr.length;
                  lastCharOffset = charOffset + charLength;
                  activeWordBoundaries.push({ audioOffsetMs, durationMs, charOffset, charLength });
                  
                  if (pendingSeekCharOffset !== null && charOffset >= pendingSeekCharOffset) {
                     activePort?.postMessage({ type: "SEEK", offset: audioOffsetMs / 1000 });
                     pendingSeekCharOffset = null;
                  }
                }
              }
          }
        } else if (msg.type === "WordBoundaryArray") {
          for (const wb of msg.data) {
             const audioOffsetMs = wb.offset / 10000;
             const durationMs = wb.duration / 10000;
             const wordStr = wb.textObj || "";
             if (wordStr.length > 0) {
                const charOffset = fullTextToRead.indexOf(wordStr, lastCharOffset);
                if (charOffset !== -1) {
                  const charLength = wordStr.length;
                  lastCharOffset = charOffset + charLength;
                  activeWordBoundaries.push({ audioOffsetMs, durationMs, charOffset, charLength });
                  
                  if (pendingSeekCharOffset !== null && charOffset >= pendingSeekCharOffset) {
                     activePort?.postMessage({ type: "SEEK", offset: audioOffsetMs / 1000 });
                     pendingSeekCharOffset = null;
                  }
                }
              }
          }
        } else if (msg.type === "end") {
          // offscreen handles the actual media ending
        } else if (msg.type === "error") {
          console.error("Stream error from background:", msg.error);
          alert("Edge Natural TTS Error: " + msg.error);
          stopSession();
        }
      });

      activePort.onDisconnect.addListener(() => {
        if (currentHighlightTick) {
          clearInterval(currentHighlightTick);
          currentHighlightTick = null;
        }
      });

      // Preload the next 2 chunks
      let nextPreloadEl = getNextValidElement(activeTarget!);
      for (let i = 0; i < 2; i++) {
        if (nextPreloadEl) {
          const nextText = extractRawText(nextPreloadEl);
          if (nextText.trim()) {
            activePort.postMessage({ type: "PRELOAD", text: nextText, voice, rateString });
          }
          nextPreloadEl = getNextValidElement(nextPreloadEl);
        } else {
          break;
        }
      }

     } catch (innerError) {
       console.error("TTS generation failed (inner):", innerError);
       stopSession();
     }
    });
  } catch (error) {
    console.error("TTS generation failed:", error);
    stopSession();
  }
};
