// Prevent multiple injections
if (window.grugContentScriptLoaded) {
  console.log("Grug content script already loaded, skipping");
} else {
  window.grugContentScriptLoaded = true;

  class GrugContentScript {
    constructor() {
      this.isTranslating = false;
      this.originalTexts = new Map();
      this.translatedTexts = new Map();
      this.isGrugMode = false;
      this.textNodes = [];
      this.animationOverlay = null;
      this.animationInterval = null;
      this.animationFrame = 1;

      this.init();
    }

    async init() {
      await this.loadState();
      this.findTextNodes();
      this.setupMessageListener();

      // Signal that content script is ready
      window.grugContentScriptReady = true;
      window.dispatchEvent(new CustomEvent("grugContentScriptReady"));

      if (this.isGrugMode) {
        this.translatePage();
      }
    }

    async loadState() {
      try {
        const result = await chrome.storage.local.get(["grugModeEnabled"]);
        this.isGrugMode = result.grugModeEnabled || false;
      } catch (error) {
        console.log("grug load state failed:", error);
      }
    }

    async saveState() {
      try {
        await chrome.storage.local.set({ grugModeEnabled: this.isGrugMode });
      } catch (error) {
        console.log("grug save state failed:", error);
      }
    }

    findTextNodes() {
      this.textNodes = [];
      this.walkTextNodes(document.body);
      console.log(`Found ${this.textNodes.length} text nodes to translate`);
    }

    walkTextNodes(node) {
      if (!node) return;

      // Skip script, style, and other non-visible elements
      if (
        node.tagName &&
        ["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE"].includes(node.tagName)
      ) {
        return;
      }

      // Skip elements that are likely UI components
      if (
        node.classList &&
        (node.classList.contains("button") ||
          node.classList.contains("btn") ||
          node.classList.contains("icon") ||
          node.classList.contains("fa") || // FontAwesome
          node.classList.contains("material-icons"))
      ) {
        return;
      }

      if (node.nodeType === Node.TEXT_NODE) {
        // Don't trim here - we need to preserve whitespace
        const text = node.textContent;
        const trimmedText = text.trim();
        // Check trimmed version for translatability but keep original node with whitespace
        if (trimmedText.length > 5 && this.isTranslatableText(trimmedText)) {
          this.textNodes.push(node);
        } else if (trimmedText.length > 0) {
          // Log what we're skipping
          console.log("Skipping text node:", {
            length: trimmedText.length,
            hasGrug: trimmedText.toLowerCase().includes("grug"),
            isNumbers: /^\d+$/.test(trimmedText),
            isPunctuation: /^[^\w\s]+$/.test(trimmedText),
            text:
              trimmedText.substring(0, 50) +
              (trimmedText.length > 50 ? "..." : ""),
          });
        }
      } else {
        for (let child of node.childNodes) {
          this.walkTextNodes(child);
        }
      }
    }

    isTranslatableText(text) {
      // Skip numbers only, or mostly punctuation
      // (length check already done in walkTextNodes with trimmed text)
      if (/^\d+$/.test(text)) return false;
      if (/^[^\w\s]+$/.test(text)) return false;

      // Skip if already looks like grug text
      if (text.toLowerCase().includes("grug")) return false;

      return true;
    }

    async translatePage() {
      if (this.isTranslating) return;

      this.isTranslating = true;
      this.showProgress("grug translating...");

      // Start animation overlay for grugifying
      this.startAnimation();

      // Dispatch translation start event
      window.dispatchEvent(new CustomEvent("grugTranslationStart"));

      try {
        // Collect all text content and preserve whitespace info
        const textData = this.textNodes.map((node) => {
          const fullText = node.textContent;
          const trimmed = fullText.trim();
          const leadingSpace = fullText.match(/^\s*/)[0];
          const trailingSpace = fullText.match(/\s*$/)[0];
          return {
            fullText,
            trimmed,
            leadingSpace,
            trailingSpace,
          };
        });
        const allTexts = textData.map((data) => data.trimmed);
        const delimiter = "\n\n<<GRUG_DELIMITER_DO_NOT_TRANSLATE>>\n\n";

        // Process in chunks if text is too large
        const MAX_CHUNK_SIZE = 30000; // Conservative limit
        const chunks = [];
        let currentChunk = [];
        let currentSize = 0;

        for (let i = 0; i < allTexts.length; i++) {
          const textLength = allTexts[i].length + delimiter.length;
          if (
            currentSize + textLength > MAX_CHUNK_SIZE &&
            currentChunk.length > 0
          ) {
            chunks.push({
              texts: currentChunk,
              startIndex: i - currentChunk.length,
              endIndex: i - 1,
            });
            currentChunk = [];
            currentSize = 0;
          }
          currentChunk.push(allTexts[i]);
          currentSize += textLength;
        }

        if (currentChunk.length > 0) {
          chunks.push({
            texts: currentChunk,
            startIndex: allTexts.length - currentChunk.length,
            endIndex: allTexts.length - 1,
          });
        }

        console.log(
          `Processing ${allTexts.length} text nodes in ${chunks.length} chunks`
        );

        // Process each chunk
        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
          const chunk = chunks[chunkIndex];
          const combinedText = chunk.texts.join(delimiter);

          console.log(
            `Processing chunk ${chunkIndex + 1}/${chunks.length}: ${
              chunk.texts.length
            } texts, ${combinedText.length} chars`
          );

          const response = await chrome.runtime.sendMessage({
            action: "translateBatch",
            text: combinedText,
          });

          if (response.success) {
            const translatedSections = response.translatedText.split(delimiter);

            console.log(
              `Chunk ${chunkIndex + 1}: Received ${
                translatedSections.length
              } sections for ${chunk.texts.length} texts`
            );

            // Apply translations for this chunk
            for (
              let i = 0;
              i < translatedSections.length && i < chunk.texts.length;
              i++
            ) {
              const nodeIndex = chunk.startIndex + i;
              const node = this.textNodes[nodeIndex];
              const originalData = textData[nodeIndex];

              if (
                node &&
                translatedSections[i] !== undefined &&
                translatedSections[i] !== ""
              ) {
                const originalText = originalData.fullText;
                const translatedTrimmed = translatedSections[i].trim();
                // Reconstruct with original whitespace
                const translatedText =
                  originalData.leadingSpace +
                  translatedTrimmed +
                  originalData.trailingSpace;

                this.originalTexts.set(node, originalText);
                this.translatedTexts.set(originalText, translatedText);
                node.textContent = translatedText;

                // Only add visual indicator if text actually changed
                if (originalData.trimmed !== translatedTrimmed) {
                  this.addGrugStyle(node.parentElement);
                }
              }
            }

            // Update progress
            this.updateProgress(
              `grug translating... (${Math.min(
                ((chunkIndex + 1) * 100) / chunks.length,
                100
              ).toFixed(0)}%)`
            );
          } else {
            console.error(
              `Failed to translate chunk ${chunkIndex + 1}:`,
              response.error
            );
          }
        }

        console.log(
          `Translation complete. Processed ${this.originalTexts.size} text nodes.`
        );

        this.hideProgress();
      } catch (error) {
        console.error("grug translation failed:", error);
        this.showError("grug translation broke: " + error.message);
        this.stopAnimation(); // Stop animation on error
      }

      this.isTranslating = false;

      // Stop animation overlay
      this.stopAnimation();

      // Dispatch translation end event
      window.dispatchEvent(new CustomEvent("grugTranslationEnd"));
    }

    restorePage() {
      // Dispatch translation start event (for ungrug operation)
      window.dispatchEvent(new CustomEvent("grugTranslationStart"));

      for (let [textNode, originalText] of this.originalTexts) {
        if (textNode.parentElement) {
          textNode.textContent = originalText;
          this.removeGrugStyle(textNode.parentElement);
        }
      }
      this.originalTexts.clear();
      this.hideProgress();

      // Dispatch translation end event
      window.dispatchEvent(new CustomEvent("grugTranslationEnd"));
    }

    addGrugStyle(element) {
      if (element && element.classList) {
        element.classList.add("grug-translated");
      }
    }

    removeGrugStyle(element) {
      if (element && element.classList) {
        element.classList.remove("grug-translated");
      }
    }

    async toggleGrugMode() {
      this.isGrugMode = !this.isGrugMode;
      await this.saveState();

      if (this.isGrugMode) {
        this.findTextNodes();
        await this.translatePage();
      } else {
        this.restorePage();
      }

      // Update floating button state
      const floatingButton = document.getElementById("grug-floating-button");
      if (floatingButton) {
        floatingButton.classList.toggle("active", this.isGrugMode);
      }

      // Dispatch custom event for floating button
      window.dispatchEvent(
        new CustomEvent("grugStateChanged", {
          detail: { isGrugMode: this.isGrugMode },
        })
      );

      // Notify popup of state change
      chrome.runtime.sendMessage({
        action: "stateChanged",
        isGrugMode: this.isGrugMode,
      });
    }

    showProgress(message) {
      this.removeProgress();

      const progressDiv = document.createElement("div");
      progressDiv.id = "grug-progress";
      progressDiv.style.cssText = `
      position: fixed;
      top: 90px;
      right: 20px;
      background: #4a90e2;
      color: white;
      padding: 10px 15px;
      border-radius: 5px;
      font-family: monospace;
      font-size: 14px;
      z-index: 10000;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    `;
      progressDiv.textContent = message;
      document.body.appendChild(progressDiv);
    }

    updateProgress(message) {
      const progressDiv = document.getElementById("grug-progress");
      if (progressDiv) {
        progressDiv.textContent = message;
      }
    }

    showError(message) {
      this.removeProgress();

      const errorDiv = document.createElement("div");
      errorDiv.id = "grug-error";
      errorDiv.style.cssText = `
      position: fixed;
      top: 90px;
      right: 20px;
      background: #e74c3c;
      color: white;
      padding: 10px 15px;
      border-radius: 5px;
      font-family: monospace;
      font-size: 14px;
      z-index: 10000;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      cursor: pointer;
    `;
      errorDiv.textContent = message;
      errorDiv.onclick = () => errorDiv.remove();
      document.body.appendChild(errorDiv);

      setTimeout(() => errorDiv.remove(), 5000);
    }

    hideProgress() {
      this.removeProgress();
    }

    removeProgress() {
      const existing =
        document.getElementById("grug-progress") ||
        document.getElementById("grug-error");
      if (existing) existing.remove();
    }

    createAnimationIcon(targetElement) {
      this.removeAnimationOverlay();

      if (!targetElement) return null;

      // Get the position of the target element
      const rect = targetElement.getBoundingClientRect();

      const animationImg = document.createElement("img");
      animationImg.id = "grug-animation-icon";
      animationImg.style.cssText = `
      position: absolute;
      top: ${rect.top + window.scrollY - 5}px;
      left: ${rect.right + window.scrollX - 40}px;
      width: 50px;
      height: 50px;
      z-index: 999999;
      pointer-events: none;
      object-fit: contain;
    `;
      animationImg.src = chrome.runtime.getURL(
        "images/frame1_animation_bat_squashing_brain.png"
      );

      document.body.appendChild(animationImg);

      this.animationOverlay = animationImg;
      return animationImg;
    }

    startAnimation() {
      // Find the first text node's parent element to position the animation
      const firstTextNode = this.textNodes[0];
      const targetElement = firstTextNode ? firstTextNode.parentElement : null;

      if (!targetElement) return;

      const animationImg = this.createAnimationIcon(targetElement);
      if (!animationImg) return;

      this.animationFrame = 1;
      this.animationInterval = setInterval(() => {
        const frameUrl =
          this.animationFrame === 1
            ? chrome.runtime.getURL(
                "images/frame1_animation_bat_squashing_brain.png"
              )
            : chrome.runtime.getURL(
                "images/frame2_animation_bat_squashing_brain.png"
              );
        animationImg.src = frameUrl;
        this.animationFrame = this.animationFrame === 1 ? 2 : 1;
      }, 500); // Switch frames every 500ms
    }

    stopAnimation() {
      if (this.animationInterval) {
        clearInterval(this.animationInterval);
        this.animationInterval = null;
      }
      this.removeAnimationOverlay();
      this.animationFrame = 1;
    }

    removeAnimationOverlay() {
      // Remove both old overlay and new icon versions
      const existingOverlay = document.getElementById("grug-animation-overlay");
      const existingIcon = document.getElementById("grug-animation-icon");

      if (existingOverlay) existingOverlay.remove();
      if (existingIcon) existingIcon.remove();

      if (this.animationOverlay) {
        this.animationOverlay.remove();
        this.animationOverlay = null;
      }
    }

    setupMessageListener() {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "toggleGrugMode") {
          this.toggleGrugMode()
            .then(() => {
              sendResponse({ success: true, isGrugMode: this.isGrugMode });
            })
            .catch((error) => {
              sendResponse({ success: false, error: error.message });
            });
          return true; // Keep channel open for async response
        }

        if (request.action === "getState") {
          sendResponse({ isGrugMode: this.isGrugMode });
        }

        if (request.action === "checkContentScript") {
          sendResponse({ success: true });
        }

        if (request.action === "ping") {
          sendResponse({ success: true });
        }
      });
    }

    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
  }

  // Add CSS for translated elements
  const style = document.createElement("style");
  style.textContent = `
  .grug-translated {
    background-color: rgba(255, 255, 0, 0.1) !important;
    border-left: 3px solid #ffa500 !important;
    padding-left: 5px !important;
    transition: all 0.3s ease !important;
  }

  .grug-translated .grug-translated {
    background-color: transparent !important;
    border-left: none !important;
    padding-left: 0 !important;
  }
`;
  document.head.appendChild(style);

  // Initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => new GrugContentScript()
    );
  } else {
    new GrugContentScript();
  }
} // End of injection guard
