# Mindmap - Visual Learning & Card Linking

Enhance your Anki learning experience with visual organization. This plugin allows you to create mind maps directly within Anki, link them to your flashcards, and navigate bidirectionally between your visual structures and spaced repetition cards.

## &#9889; Quick Start Workflow

Follow these steps to create your first linked mind map:

1.  **Create Map:** Go to `Tools -> Mind Map -> Mind Map Manager` and click **New**.
2.  **Link Card:** Open the Anki "Add" window or "Browser". Click the **MM** button in the editor toolbar and select your map.
3.  **Edit Content:** **IMPORTANT!** Edit the **first line** of the card's "Front" field. This line directly corresponds to the node's text in the mind map.
4.  **View Node:** Return to the Mind Map editor and press **F5** (Refresh). You will see your new node linked automatically.
5.  **Navigate:**
    * **In Mind Map:** Right-click a node -> "Jump to Card" to open it in the Browser.
    * **In Review:** Click the **Mind Map Badge** in the top-right corner to jump instantly to the context node.

> **Tip:** Not all nodes need to be linked to cards. You can freely create unlinked nodes for structure, titles, or brainstorming!

---

## &#9888; Important: First Time Sync

**CRITICAL STEP FOR NEW USERS**

After installing this add-on or using the Active/Inactive feature for the first time, Anki will detect database structure changes (due to the new "MindMap Master" note type).

When Anki asks you to Sync, you **MUST** choose: **"Upload to AnkiWeb"**.

* This is a **one-time** requirement.
* Future operations (adding nodes, linking cards) will sync normally and bidirectionally.

---

## &#128279; Seamless Card Linking

Designed for simplicity and compatibility with all note types:

* **One-Way Initiation:** Links are initiated **from the Card** to the Mind Map using the MM button. This keeps your workflow clean.
* **Bidirectional Content Sync:**
    * **Map to Card:** Editing a node updates the *first line* of the card's Front field.
    * **Card to Map:** Editing the *first line* of the card's Front field automatically updates the Mind Map node.

## &#128161; Powerful Editor Features

* **Smart Paste:** Copy text from anywhere (browser, PDF). Select a node and press `Ctrl+V`. A new child node containing that text is automatically created and selected.
* **Floating Nodes:** Double-click on any empty space to create independent "floating nodes". Perfect for brainstorming ideas before organizing them into the main tree.
* **Drag & Drop:** Easily rearrange nodes or attach floating nodes to the main tree by dragging.
* **MathJax Support:** Full support for MathJax formulas (inline `\(...\)` and block `\[...\]`).
* **Undo/Redo:** Full history support with `Ctrl+Z` (Undo) and `Ctrl+Y` / `Ctrl+Shift+Z` (Redo).

## &#9881; Customization

Go to `Tools -> Add-ons -> Mind Map -> Config` to tailor the experience:

* **Line Color:** Customize connection lines (e.g., `"red"`, `"#4CAF50"`, or `"rgba(139, 92, 246, 0.6)"`).
* **Backgrounds:** Add your own images to the `backgrounds` folder and set them in the config.
* **Hotkeys:** Remap standard actions like Save (`Ctrl+S`), Refresh (`F5`), or Focus Root (`Ctrl+R`).

## &#128190; Backup & Portable Export

Never lose your data. The built-in **Backup & Recovery** tool allows you to:

* **Export to JSON:** Back up all your mind maps safely.
* **Offline Viewer:** Every export includes a standalone `MindMap_Viewer.html`. You can open this file in any web browser to view your mind maps on any device, even without Anki installed.