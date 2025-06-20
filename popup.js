class GrugPopup {
  constructor() {
    this.apiKey = "";
    this.isGrugMode = false;
    this.currentTab = null;
    this.init();
  }

  async init() {
    await this.loadApiKey();
    await this.getCurrentTab();
    await this.loadCurrentState();
    this.setupEventListeners();
    this.updateUI();
    this.updatePageInfo();
    
    // Collapse API section if key is already set
    if (this.apiKey) {
      this.collapseApiSection();
    }
  }

  async loadApiKey() {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "getApiKey",
      });
      if (response.success) {
        this.apiKey = response.apiKey;
        document.getElementById("apiKey").value = this.apiKey;
      }
    } catch (error) {
      console.error("grug load api key failed:", error);
    }
  }

  async getCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      this.currentTab = tab;
      // Small delay to ensure content script is ready
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (error) {
      console.error("grug get tab failed:", error);
    }
  }

  async loadCurrentState() {
    if (!this.currentTab) {
      this.isGrugMode = false;
      return;
    }

    try {
      // Try to get the current state from the content script
      const response = await chrome.tabs.sendMessage(this.currentTab.id, {
        action: "getState"
      });
      
      if (response && typeof response.isGrugMode !== 'undefined') {
        this.isGrugMode = response.isGrugMode;
      } else {
        this.isGrugMode = false;
      }
    } catch (error) {
      // Content script not loaded or error, assume not in grug mode
      this.isGrugMode = false;
    }
  }


  setupEventListeners() {
    const toggleBtn = document.getElementById("toggleBtn");
    const saveBtn = document.getElementById("saveApiKey");
    const apiKeyInput = document.getElementById("apiKey");
    const apiHeader = document.getElementById("apiHeader");

    toggleBtn.addEventListener("click", () => this.toggleGrugMode());
    saveBtn.addEventListener("click", () => this.saveApiKey());
    apiHeader.addEventListener("click", () => this.toggleApiSection());

    apiKeyInput.addEventListener("input", (e) => {
      this.apiKey = e.target.value.trim();
      this.updateUI();
    });

    apiKeyInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        this.saveApiKey();
      }
    });
  }

  toggleApiSection() {
    const apiContent = document.getElementById("apiContent");
    apiContent.classList.toggle("collapsed");
  }

  collapseApiSection() {
    const apiContent = document.getElementById("apiContent");
    apiContent.classList.add("collapsed");
  }

  expandApiSection() {
    const apiContent = document.getElementById("apiContent");
    apiContent.classList.remove("collapsed");
  }

  updatePageInfo() {
    const pageTitleEl = document.getElementById("pageTitle");
    const pageUrlEl = document.getElementById("pageUrl");
    
    if (this.currentTab) {
      pageTitleEl.textContent = this.currentTab.title || "Untitled Page";
      pageUrlEl.textContent = this.currentTab.url || "";
    } else {
      pageTitleEl.textContent = "No page selected";
      pageUrlEl.textContent = "";
    }
  }

  async toggleGrugMode() {
    if (!this.apiKey) {
      this.expandApiSection();
      document.getElementById("apiKey").focus();
      return;
    }

    if (!this.currentTab) {
      this.showStatus("grug confused about tab", "error");
      return;
    }

    try {
      const toggleBtn = document.getElementById("toggleBtn");
      toggleBtn.disabled = true;

      // Inject content script first
      await chrome.scripting.executeScript({
        target: { tabId: this.currentTab.id },
        files: ["content.js"],
      });

      // Send toggle message and wait for response
      const response = await chrome.tabs.sendMessage(this.currentTab.id, {
        action: "toggleGrugMode",
      });

      // Update state based on actual response
      if (response && typeof response.isGrugMode !== 'undefined') {
        this.isGrugMode = response.isGrugMode;
      } else {
        // Fallback to toggle if no response
        this.isGrugMode = !this.isGrugMode;
      }
      
      this.updateUI();
    } catch (error) {
      console.error("grug toggle failed:", error);
    } finally {
      const toggleBtn = document.getElementById("toggleBtn");
      toggleBtn.disabled = false;
    }
  }

  async saveApiKey() {
    if (!this.apiKey) {
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        action: "setApiKey",
        apiKey: this.apiKey,
      });

      if (response.success) {
        this.updateUI();
        this.collapseApiSection();
      }
    } catch (error) {
      console.error("grug save api key failed:", error);
    }
  }


  updateUI() {
    const toggleBtn = document.getElementById("toggleBtn");
    const toggleText = document.getElementById("toggleText");
    const checkmarkIcon = document.getElementById("checkmarkIcon");
    const apiLabelText = document.getElementById("apiLabelText");

    // Update toggle button
    if (this.isGrugMode) {
      toggleBtn.classList.add("active");
      toggleText.textContent = "make page for big brain";
    } else {
      toggleBtn.classList.remove("active");
      toggleText.textContent = "make page for grug";
    }

    // Disable toggle if no API key
    toggleBtn.disabled = !this.apiKey;

    // Update API section
    if (this.apiKey) {
      checkmarkIcon.style.display = "flex";
      apiLabelText.textContent = "gemini api key set";
      apiLabelText.classList.add("set");
    } else {
      checkmarkIcon.style.display = "none";
      apiLabelText.textContent = "gemini api key";
      apiLabelText.classList.remove("set");
    }
  }


}

// Initialize popup when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  new GrugPopup();
});