var jm = null;
var autoSaveTimeout = null;
var autoSaveDelay = 2000;

var mindMapHistory = [];
var mindMapHistoryIndex = -1;
var maxHistory = 50;

var selectedNodes = [];
var isEditing = false;
var editingNodeId = null;
var selectionBox = null;
var isSelecting = false;
var selectionStart = { x: 0, y: 0 };

var arrows = [];
var arrowMode = false;
var arrowStart = null;

// Floating nodes (nodes without parent)
var floatingNodes = [];
var floatingNodeIdPrefix = 'floating_';

// Track changed node IDs (for syncing to cards)
var changedNodes = new Set();

// Hotkey configuration (loaded from config, defaults here)
var hotkeyConfig = {
    save: 'Ctrl+S',
    refresh: 'F5',
    focus_root: 'Ctrl+R'
};

// Match hotkey event against config string
function matchHotkey(e, hotkeyString) {
    if (!hotkeyString) return false;

    var parts = hotkeyString.split('+');
    var key = parts[parts.length - 1];
    var needsCtrl = parts.includes('Ctrl');
    var needsMeta = parts.includes('Meta') || parts.includes('Cmd');
    var needsShift = parts.includes('Shift');
    var needsAlt = parts.includes('Alt');

    var eventKey = e.key;

    // For non-F-keys, do case-insensitive comparison
    if (!key.match(/^F\d+$/)) {
        key = key.toLowerCase();
        eventKey = eventKey.toLowerCase();
    }

    return eventKey === key &&
        (e.ctrlKey || e.metaKey) === (needsCtrl || needsMeta) &&
        e.shiftKey === needsShift &&
        e.altKey === needsAlt;
}

function initEditor(data) {
    try {
        if (typeof jsMind === 'undefined') {
            alert("Error: jsMind library not loaded");
            return;
        }

        if (typeof data === 'string') {
            data = JSON.parse(data);
        }

        if (data.nodeData) {
            data = {
                "meta": { "name": "map", "author": "anki", "version": "0.2" },
                "format": "node_tree",
                "data": { "id": "root", "topic": data.nodeData.topic || "Map" }
            };
        }

        jm = new jsMind({
            container: 'jsmind_container',
            theme: 'modern-premium',
            editable: true,
            support_html: true,
            view: {
                draggable: true,
                line_width: 3,
                line_color: (typeof lineColorFromPython !== 'undefined' ? lineColorFromPython : 'rgba(139, 92, 246, 0.6)')
            },
            shortcut: { enable: false }
        });

        jm.add_event_listener(function (type, data) {
            if (type === 3) {
                console.log('Detected change...');
                window.saveHistory();
                scheduleAutoSave();
            }
        });

        jm.show(data);
        saveHistory();

        if (data.data && data.data.id) {
            jm.select_node(data.data.id);
        }

        setTimeout(() => {
            document.getElementById('jsmind_container').focus();
        }, 100);

        setTimeout(renderMath, 500);
        setupMultiSelection();
        setupFloatingNodes();

        // Load floating nodes if they exist
        if (data.floatingNodes && Array.isArray(data.floatingNodes)) {
            data.floatingNodes.forEach(function (nodeData) {
                loadFloatingNode(nodeData);
            });
        }

        jm.add_event_listener(function (type, data) {
            // type 3 代表 edit 事件
            if (type === 3) {
                console.log('Detected change, saving history...');
                saveHistory();
                scheduleAutoSave();
            }
        });

        console.log("jsMind initialized");

        // Override update_node method to track changes and auto-save
        if (jm && jm.update_node) {
            var originalUpdateNode = jm.update_node;
            jm.update_node = function (nodeid, topic) {
                var result = originalUpdateNode.call(jm, nodeid, topic);
                changedNodes.add(nodeid);
                console.log('Node changed:', nodeid, 'New topic:', topic);

                // Auto-save immediately (short delay to merge rapid edits)
                if (autoSaveTimeout) {
                    clearTimeout(autoSaveTimeout);
                }
                autoSaveTimeout = setTimeout(function () {
                    console.log('Auto-saving after node edit...');
                    autoSave();
                }, 300); // 300ms delay, enough to merge edits without losing data

                return result;
            };
        }

        // Mark nodes linked to cards after initial render
        setTimeout(markLinkedNodes, 100);

    } catch (e) {
        alert("Error: " + e);
        console.error(e);
    }
}

// Load a floating node from saved data
function loadFloatingNode(nodeData) {
    if (!jm) return;

    var container = document.getElementById('jsmind_container');
    if (!container) return;

    // Create node element
    var nodeElement = document.createElement('jmnode');
    nodeElement.setAttribute('nodeid', nodeData.id);
    nodeElement.innerHTML = nodeData.topic || ''; // Use saved topic or empty
    nodeElement.style.position = 'absolute';
    nodeElement.style.left = nodeData.x + 'px';
    nodeElement.style.top = nodeData.y + 'px';
    nodeElement.style.padding = '10px 15px';
    nodeElement.style.backgroundColor = '#fff';
    nodeElement.style.border = '3px solid #000'; // Black border for floating nodes
    nodeElement.style.borderRadius = '5px';
    nodeElement.style.cursor = 'move';
    nodeElement.style.zIndex = '2';
    nodeElement.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
    nodeElement.style.minWidth = '80px';
    nodeElement.style.textAlign = 'center';
    nodeElement.style.fontSize = '14px';
    nodeElement.style.color = '#000';
    nodeElement.style.display = 'inline-block';
    nodeElement.style.whiteSpace = 'pre-wrap';
    nodeElement.style.wordWrap = 'break-word';

    // Add to container
    var nodesContainer = container.querySelector('jmnodes');
    if (!nodesContainer) {
        nodesContainer = document.createElement('jmnodes');
        container.appendChild(nodesContainer);
    }
    nodesContainer.appendChild(nodeElement);

    // Store floating node data
    var floatingNode = {
        id: nodeData.id,
        element: nodeElement,
        topic: nodeData.topic,
        x: nodeData.x,
        y: nodeData.y,
        children: [],
        isFloating: true
    };
    floatingNodes.push(floatingNode);

    // Setup drag and edit functionality
    setupFloatingNodeDrag(floatingNode);
    setupFloatingNodeEdit(floatingNode);
}

// Setup floating nodes functionality
function setupFloatingNodes() {
    var container = document.getElementById('jsmind_container');
    if (!container) return;

    // Double-click on empty space to create floating node
    container.addEventListener('dblclick', function (e) {
        if (jm && !jm.get_editable()) return;
        if (typeof enableFloatingNodesFromPython !== 'undefined' && !enableFloatingNodesFromPython) {
            return;
        }
        // Check if clicked on empty space (not on a node)
        var target = e.target;
        if (target.tagName && target.tagName.toLowerCase() === 'jmnode') {
            return; // Clicked on a node, ignore
        }

        // Create floating node at click position
        createFloatingNode(e.clientX, e.clientY);
        e.preventDefault();
        e.stopPropagation();
    });
}

// Create a floating node (independent node without parent)
function createFloatingNode(clientX, clientY) {
    if (!jm) return;

    var container = document.getElementById('jsmind_container');
    if (!container) return;

    var jview = jm.view;

    // Get the nodes container
    var nodesContainer = container.querySelector('jmnodes');
    if (!nodesContainer) {
        nodesContainer = document.createElement('jmnodes');
        container.appendChild(nodesContainer);
    }

    // Calculate position relative to the scrolling panel
    // Try to get e_panel from view, or find it by class
    var e_panel = (jview && jview.e_panel) || container.querySelector('.jsmind-inner');

    if (!e_panel) {
        console.error("Could not find scrolling panel");
        return;
    }

    var panelRect = e_panel.getBoundingClientRect();
    var zoom = (jview && jview.actualZoom) || 1;

    // Convert client X/Y to canvas coordinates
    // Correct formula: (Relative Screen Pos / Zoom) + Scroll Offset
    var canvasX = (clientX - panelRect.left) / zoom + e_panel.scrollLeft;
    var canvasY = (clientY - panelRect.top) / zoom + e_panel.scrollTop;

    // Create node element
    var nodeId = floatingNodeIdPrefix + Date.now();
    var nodeElement = document.createElement('jmnode');
    nodeElement.setAttribute('nodeid', nodeId);
    nodeElement.innerHTML = ''; // Empty node
    nodeElement.style.position = 'absolute';
    nodeElement.style.padding = '10px 15px';
    nodeElement.style.backgroundColor = '#fff';
    nodeElement.style.border = '3px solid #000';
    nodeElement.style.borderRadius = '5px';
    nodeElement.style.cursor = 'move';
    nodeElement.style.zIndex = '2';
    nodeElement.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
    nodeElement.style.minWidth = '80px';
    nodeElement.style.textAlign = 'center';
    nodeElement.style.fontSize = '14px';
    nodeElement.style.color = '#000';
    nodeElement.style.display = 'inline-block';
    nodeElement.style.whiteSpace = 'pre-wrap';
    nodeElement.style.wordWrap = 'break-word';

    // Set initial position
    nodeElement.style.left = canvasX + 'px';
    nodeElement.style.top = canvasY + 'px';

    // Add to container
    nodesContainer.appendChild(nodeElement);

    // Store floating node data
    var floatingNode = {
        id: nodeId,
        element: nodeElement,
        topic: '',
        x: canvasX,
        y: canvasY,
        children: [],
        isFloating: true
    };
    floatingNodes.push(floatingNode);

    // Adjust position after rendering to center on click point
    setTimeout(function () {
        var actualWidth = nodeElement.offsetWidth;
        var actualHeight = nodeElement.offsetHeight;
        var centeredX = canvasX - actualWidth / 2;
        var centeredY = canvasY - actualHeight / 2;

        nodeElement.style.left = centeredX + 'px';
        nodeElement.style.top = centeredY + 'px';

        floatingNode.x = centeredX;
        floatingNode.y = centeredY;
    }, 0);

    // Setup drag and edit functionality
    setupFloatingNodeDrag(floatingNode);
    setupFloatingNodeEdit(floatingNode);

    // Select the new node
    selectFloatingNode(floatingNode);

    saveHistory();
    scheduleAutoSave();
}

// Setup drag functionality for floating node
function setupFloatingNodeDrag(floatingNode) {
    var element = floatingNode.element;
    var isDragging = false;
    var offsetX, offsetY;
    var mouseMoveHandler, mouseUpHandler;
    var originalTransition = '';

    element.addEventListener('mousedown', function (e) {
        if (jm && !jm.get_editable()) return;
        if (e.target !== element && e.target.parentElement !== element) return;
        if (isEditing) return; // Don't drag while editing

        isDragging = true;
        element.style.cursor = 'grabbing';

        // Disable transition during drag to prevent lag/delay
        originalTransition = element.style.transition;
        element.style.transition = 'none';

        e.preventDefault();
        e.stopPropagation();

        // Get view parameters
        var jview = jm.view;
        var zoom = (jview && jview.actualZoom) || 1;

        // For floating nodes, use style.left/top (actual position) not offsetLeft/Top
        var currentLeft = parseFloat(element.style.left) || 0;
        var currentTop = parseFloat(element.style.top) || 0;

        // Calculate offset exactly like jsMind does for regular nodes
        // offset = (clientX / zoom) - current position
        offsetX = e.clientX / zoom - currentLeft;
        offsetY = e.clientY / zoom - currentTop;

        var frameCount = 0; // For throttling attach check

        // Add event listeners for this drag session
        mouseMoveHandler = function (e) {
            if (!isDragging) return;

            // Get current zoom
            var currentZoom = (jview && jview.actualZoom) || 1;

            // Calculate position exactly like jsMind does for regular nodes
            // position = (clientX / zoom) - offset
            var px = e.clientX / currentZoom - offsetX;
            var py = e.clientY / currentZoom - offsetY;

            element.style.left = px + 'px';
            element.style.top = py + 'px';

            floatingNode.x = px;
            floatingNode.y = py;

            // Check attach less frequently for performance (every 5 frames)
            frameCount++;
            if (frameCount % 5 === 0) {
                checkAttachToNode(floatingNode);
            }

            e.preventDefault();
            e.stopPropagation();
        };

        mouseUpHandler = function (e) {
            if (!isDragging) return;

            isDragging = false;
            element.style.cursor = 'move';

            // Restore transition
            element.style.transition = originalTransition;

            // Try to attach to nearby node
            tryAttachToNode(floatingNode);

            saveHistory();
            scheduleAutoSave();

            // Remove event listeners
            document.removeEventListener('mousemove', mouseMoveHandler);
            document.removeEventListener('mouseup', mouseUpHandler);
        };

        document.addEventListener('mousemove', mouseMoveHandler);
        document.addEventListener('mouseup', mouseUpHandler);
    });
}


// Check if floating node is close to any jsMind node
function checkAttachToNode(floatingNode) {
    var element = floatingNode.element;
    var rect = element.getBoundingClientRect();
    var centerX = rect.left + rect.width / 2;
    var centerY = rect.top + rect.height / 2;

    var allJsNodes = document.querySelectorAll('jmnode:not([nodeid^="floating_"])');
    var closestNode = null;
    var minDistance = 100; // Threshold distance in pixels

    for (var i = 0; i < allJsNodes.length; i++) {
        var node = allJsNodes[i];
        var nodeRect = node.getBoundingClientRect();
        var nodeCenterX = nodeRect.left + nodeRect.width / 2;
        var nodeCenterY = nodeRect.top + nodeRect.height / 2;

        var distance = Math.sqrt(
            Math.pow(centerX - nodeCenterX, 2) +
            Math.pow(centerY - nodeCenterY, 2)
        );

        if (distance < minDistance) {
            minDistance = distance;
            closestNode = node;
        }
    }

    // Visual feedback when close to a node
    if (closestNode && minDistance < 80) {
        element.style.borderColor = '#4dc4ff';
        element.style.borderWidth = '3px';
        closestNode.style.boxShadow = '0 0 10px #4dc4ff';
    } else {
        element.style.borderColor = '#000';
        // Clear all node shadows
        allJsNodes.forEach(function (node) {
            node.style.boxShadow = '';
        });
    }
}

// Try to attach floating node to nearby jsMind node
function tryAttachToNode(floatingNode) {
    var element = floatingNode.element;
    var rect = element.getBoundingClientRect();
    var centerX = rect.left + rect.width / 2;
    var centerY = rect.top + rect.height / 2;

    var allJsNodes = document.querySelectorAll('jmnode:not([nodeid^="floating_"])');
    var closestNode = null;
    var minDistance = 80; // Threshold distance

    for (var i = 0; i < allJsNodes.length; i++) {
        var node = allJsNodes[i];
        var nodeRect = node.getBoundingClientRect();
        var nodeCenterX = nodeRect.left + nodeRect.width / 2;
        var nodeCenterY = nodeRect.top + nodeRect.height / 2;

        var distance = Math.sqrt(
            Math.pow(centerX - nodeCenterX, 2) +
            Math.pow(centerY - nodeCenterY, 2)
        );

        if (distance < minDistance) {
            minDistance = distance;
            closestNode = node;
        }
    }

    if (closestNode) {
        // Attach to the closest node
        var targetNodeId = closestNode.getAttribute('nodeid');
        var targetNode = jm.get_node(targetNodeId);

        if (targetNode) {
            // Add as child to jsMind
            var newNodeId = 'node_' + Date.now();
            jm.add_node(targetNode, newNodeId, floatingNode.topic);

            // Remove floating node
            removeFloatingNode(floatingNode);

            // Select the new node
            jm.select_node(newNodeId);

            // Clear shadows
            allJsNodes.forEach(function (node) {
                node.style.boxShadow = '';
            });

            setTimeout(renderMath, 300);
        }
    } else {
        // Reset border color
        element.style.borderColor = '#000';
    }
}

// Remove floating node
function removeFloatingNode(floatingNode) {
    if (floatingNode.element && floatingNode.element.parentNode) {
        floatingNode.element.parentNode.removeChild(floatingNode.element);
    }

    var index = floatingNodes.indexOf(floatingNode);
    if (index > -1) {
        floatingNodes.splice(index, 1);
    }
}

// Setup edit functionality for floating node
function setupFloatingNodeEdit(floatingNode) {
    var element = floatingNode.element;

    // Click to select
    element.addEventListener('click', function (e) {
        if (jm && !jm.get_editable()) return;
        selectFloatingNode(floatingNode);
        e.preventDefault();
        e.stopPropagation();
    });

    // Double-click to edit
    element.addEventListener('dblclick', function (e) {
        if (jm && !jm.get_editable()) return;
        enterFloatingNodeEditMode(floatingNode);
        e.preventDefault();
        e.stopPropagation();
    });

    // Keyboard events
    element.addEventListener('keydown', function (e) {
        if (isEditing) return;
        if (jm && !jm.get_editable()) return;

        console.log('Key pressed on floating node:', e.key, 'Node:', floatingNode.id);

        // Space: edit
        if (e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            enterFloatingNodeEditMode(floatingNode);
        }
        // Tab: add child
        else if (e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            addChildToFloatingNode(floatingNode);
        }
        // Delete/Backspace: remove
        else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            e.stopPropagation();
            console.log('Deleting floating node:', floatingNode.id);
            removeFloatingNode(floatingNode);
            saveHistory();
            scheduleAutoSave();
        }
    });
}

// Currently selected floating node
var selectedFloatingNode = null;

// Select floating node
function selectFloatingNode(floatingNode) {
    // Deselect all floating nodes
    floatingNodes.forEach(function (node) {
        node.element.style.outline = 'none';
        node.isSelected = false;
    });

    // Select this one
    floatingNode.element.style.outline = '2px solid #4dc4ff';
    floatingNode.element.setAttribute('tabindex', '0');
    floatingNode.element.focus();
    floatingNode.isSelected = true;
    selectedFloatingNode = floatingNode;

    console.log('Selected floating node:', floatingNode.id);
}

// Enter edit mode for floating node
function enterFloatingNodeEditMode(floatingNode) {
    if (isEditing) return;

    isEditing = true;
    var element = floatingNode.element;
    var currentText = floatingNode.topic;

    // Create input
    var input = document.createElement('textarea');
    input.value = currentText;
    input.style.cssText = `
        width: 100%;
        height: 100%;
        border: none;
        outline: none;
        background: transparent;
        font-family: inherit;
        font-size: inherit;
        text-align: center;
        resize: none;
        padding: 0;
        margin: 0;
    `;

    element.innerHTML = '';
    element.appendChild(input);
    input.focus();
    input.select();

    // Save on Enter
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            exitFloatingNodeEditMode(floatingNode, input.value);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            exitFloatingNodeEditMode(floatingNode, currentText);
        }
        e.stopPropagation();
    });

    // Save on blur
    input.addEventListener('blur', function () {
        exitFloatingNodeEditMode(floatingNode, input.value);
    });
}

// Exit edit mode for floating node
function exitFloatingNodeEditMode(floatingNode, newText) {
    if (!isEditing) return;

    isEditing = false;
    floatingNode.topic = newText || ''; // Keep empty if no text
    floatingNode.element.innerHTML = floatingNode.topic; // Use innerHTML to match jsMind

    saveHistory();
    scheduleAutoSave();
}

// Add floating node as child (when Tab is pressed on floating node)
function addChildToFloatingNode(floatingNode) {
    // Convert floating node to jsMind node first
    var root = jm.get_root();
    var newParentId = 'node_' + Date.now();
    jm.add_node(root, newParentId, floatingNode.topic);

    // Remove floating node
    removeFloatingNode(floatingNode);

    // Add child
    var childId = 'node_' + Date.now() + '_child';
    var parentNode = jm.get_node(newParentId);
    jm.add_node(parentNode, childId, 'New Child');
    jm.select_node(childId);

    setTimeout(renderMath, 300);
    saveHistory();
    scheduleAutoSave();
}

window.saveHistory = function () {
    if (!jm) return;

    try {
        if (!Array.isArray(mindMapHistory)) {
            mindMapHistory = [];
            mindMapHistoryIndex = -1;
        }

        var mindMapData = jm.get_data('node_tree');
        var floatingData = floatingNodes.map(function (n) {
            return { id: n.id, topic: n.topic, x: n.x, y: n.y };
        });

        var currentState = {
            mind: mindMapData,
            floating: floatingData
        };
        var currentStateStr = JSON.stringify(currentState);

        if (mindMapHistoryIndex >= 0 && mindMapHistory[mindMapHistoryIndex]) {
            var lastStateStr = JSON.stringify(mindMapHistory[mindMapHistoryIndex]);
            if (currentStateStr === lastStateStr) return;
        }

        if (mindMapHistoryIndex < mindMapHistory.length - 1) {
            mindMapHistory = mindMapHistory.slice(0, mindMapHistoryIndex + 1);
        }

        mindMapHistory.push(JSON.parse(currentStateStr));

        if (mindMapHistory.length > maxHistory) {
            mindMapHistory.shift();
        } else {
            mindMapHistoryIndex++;
        }

        console.log("History saved. Total steps: " + mindMapHistory.length);
    } catch (e) {
        console.error("Error saving history:", e);
    }
};

function restoreState(state) {
    if (!state) return;
    console.log("Restoring state...");

    var panel = jm.view.e_panel;

    var lastScrollX = panel.scrollLeft;
    var lastScrollY = panel.scrollTop;

    var selectedNode = jm.get_selected_node();
    var lastSelectedId = selectedNode ? selectedNode.id : null;

    if (state.mind) {
        jm.show(state.mind);
    }

    floatingNodes = [];
    var container = document.getElementById('jsmind_container');
    var oldNodes = container.querySelectorAll('jmnode[nodeid^="floating_"]');
    oldNodes.forEach(function (el) { el.remove(); });

    if (state.floating && Array.isArray(state.floating)) {
        state.floating.forEach(function (nodeData) {
            loadFloatingNode(nodeData);
        });
    }

    if (panel) {
        panel.scrollLeft = lastScrollX;
        panel.scrollTop = lastScrollY;
    }

    if (lastSelectedId) {
        var node = jm.get_node(lastSelectedId);
        if (node) {
            jm.select_node(lastSelectedId);
        } else {
            jm.select_clear();
        }
    } else {
        jm.select_clear();
    }
}

window.undo = function () {
    console.log("Undo trigger received. Index: " + mindMapHistoryIndex);
    if (mindMapHistoryIndex > 0) {
        mindMapHistoryIndex--;
        restoreState(mindMapHistory[mindMapHistoryIndex]);
        scheduleAutoSave();
    } else {
        console.log("Nothing to undo");
    }
};

window.redo = function () {
    console.log("Redo trigger received. Index: " + mindMapHistoryIndex);
    if (mindMapHistoryIndex < mindMapHistory.length - 1) {
        mindMapHistoryIndex++;
        restoreState(mindMapHistory[mindMapHistoryIndex]);
        scheduleAutoSave();
    }
};

function scheduleAutoSave() {
    if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
    }

    autoSaveTimeout = setTimeout(function () {
        autoSave();
    }, autoSaveDelay);
}

function autoSave() {
    if (!jm) return;

    try {
        var mind_data = jm.get_data('node_tree');
        var container = document.getElementById('jsmind_container');

        // Save floating nodes data
        var floatingNodesData = floatingNodes.map(function (node) {
            return {
                id: node.id,
                topic: node.topic,
                x: node.x,
                y: node.y
            };
        });

        // Collect changed node information
        var changedNodesData = [];
        changedNodes.forEach(function (nodeId) {
            var node = jm.get_node(nodeId);

            // jsMind stores custom data in node.data
            var noteId = node && node.data && node.data.noteId;

            if (noteId) {  // Only sync nodes with linked cards
                changedNodesData.push({
                    id: nodeId,
                    topic: node.topic,
                    noteId: noteId
                });
            }
        });

        console.log('AutoSaving... Data nodes count:', mind_data.data ? countNodes(mind_data.data) : 0);
        console.log('Changed nodes to sync:', changedNodesData);

        var payload = {
            data: mind_data,
            image_html: container ? container.innerHTML : "",
            arrows: arrows,
            floatingNodes: floatingNodesData,
            changedNodes: changedNodesData  // Added
        };

        pycmd("save:" + JSON.stringify(payload));

        // Clear change records
        changedNodes.clear();

        var status = document.getElementById('auto-save-status');
        if (status) {
            status.style.opacity = '1';
            setTimeout(function () {
                status.style.opacity = '0';
            }, 1500);
        }
    } catch (e) {
        console.error("Auto-save error:", e);
    }
}

// Helper function to count nodes
function countNodes(node) {
    var count = 1;
    if (node.children) {
        for (var i = 0; i < node.children.length; i++) {
            count += countNodes(node.children[i]);
        }
    }
    return count;
}

function renderMath() {
    if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
        MathJax.typesetPromise([document.getElementById('jsmind_container')])
            .catch((err) => console.error("MathJax error:", err));
    } else {
        setTimeout(renderMath, 1000);
    }
}

// Mark nodes that are linked to Anki cards
function markLinkedNodes() {
    if (!jm) return;

    try {
        var allNodes = document.querySelectorAll('jmnode');
        allNodes.forEach(function (nodeElement) {
            var nodeId = nodeElement.getAttribute('nodeid');
            if (!nodeId) return;

            var node = jm.get_node(nodeId);
            if (!node) return;

            // Check if node has a linked card (noteId in node.data)
            var hasCard = node.data && node.data.noteId;

            if (hasCard) {
                nodeElement.setAttribute('data-has-card', 'true');
            } else {
                nodeElement.removeAttribute('data-has-card');
            }
        });
    } catch (e) {
        console.error("Error marking linked nodes:", e);
    }
}

function addChild() {
    if (!jm) return;
    var selected = jm.get_selected_node();
    if (!selected) {
        alert("Please select a node first");
        return;
    }
    var newId = 'node_' + Date.now();
    jm.add_node(selected, newId, 'New Child');
    jm.select_node(newId);
    setTimeout(renderMath, 300);
    saveHistory();
    scheduleAutoSave();
}

function addSibling() {
    if (!jm) return;
    var selected = jm.get_selected_node();
    if (!selected || selected.isroot) {
        alert("Cannot add sibling to root");
        return;
    }
    var parent = jm.get_node(selected.parent);
    if (!parent) return;
    var newId = 'node_' + Date.now();
    jm.add_node(parent, newId, 'New Sibling');
    jm.select_node(newId);
    setTimeout(renderMath, 300);
    saveHistory();
    scheduleAutoSave();
}

function saveMap() {
    if (!jm) return;
    try {
        var mind_data = jm.get_data('node_tree');
        var container = document.getElementById('jsmind_container');

        // Save floating nodes data
        var floatingNodesData = floatingNodes.map(function (node) {
            return {
                id: node.id,
                topic: node.topic,
                x: node.x,
                y: node.y
            };
        });

        // Collect changed node information
        var changedNodesData = [];
        changedNodes.forEach(function (nodeId) {
            var node = jm.get_node(nodeId);

            // jsMind stores custom data in node.data
            var noteId = node && node.data && node.data.noteId;

            if (noteId) {  // Only sync nodes with linked cards
                changedNodesData.push({
                    id: nodeId,
                    topic: node.topic,
                    noteId: noteId
                });
            }
        });

        console.log('Changed nodes to sync:', changedNodesData);

        var payload = {
            data: mind_data,
            image_html: container ? container.innerHTML : "",
            arrows: arrows,
            floatingNodes: floatingNodesData,
            changedNodes: changedNodesData  // Added
        };
        pycmd("save:" + JSON.stringify(payload));

        // Clear change records
        changedNodes.clear();

        var status = document.getElementById('auto-save-status');
        if (status) {
            status.textContent = 'Saved!';
            status.style.opacity = '1';
            setTimeout(function () {
                status.textContent = 'Auto-saved';
                status.style.opacity = '0';
            }, 2000);
        }
    } catch (e) {
        alert("Error saving: " + e);
    }
}

// Center view on root node
function centerRoot() {
    if (!jm) return;

    var root = jm.get_root();
    if (!root) return;

    // Select root node
    jm.select_node(root);

    // Use jsMind's built-in centering by calling show with keep_center=true
    jm.view.show(true);
}

// Refresh mind map data from database
function refreshMap() {
    if (!jm) return;

    console.log('Requesting data refresh...');
    // Request fresh data from Python
    pycmd("refresh_data");
}

// Toggle fullscreen mode (maximize window in Anki)
function toggleFullscreen() {
    // Use Qt's fullscreen API via pycmd
    // The browser Fullscreen API doesn't work properly in QtWebEngine
    if (typeof pycmd !== 'undefined') {
        pycmd('toggle_fullscreen');
    }
}

// Update fullscreen button text when fullscreen state changes
document.addEventListener('fullscreenchange', updateFullscreenButton);
document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
document.addEventListener('mozfullscreenchange', updateFullscreenButton);
document.addEventListener('MSFullscreenChange', updateFullscreenButton);

function updateFullscreenButton() {
    var btn = document.getElementById('fullscreen-btn');
    if (btn) {
        if (document.fullscreenElement || document.webkitFullscreenElement ||
            document.mozFullScreenElement || document.msFullscreenElement) {
            btn.textContent = '⛶ Exit Fullscreen';
        } else {
            btn.textContent = '⛶ Fullscreen';
        }
    }
}


// Reload mind map with fresh data
function reloadMapData(data) {
    if (!jm) return;

    try {
        console.log('Reloading map with fresh data...');
        console.log('Data nodes count:', data.data ? countNodes(data.data) : 0);

        // Save current selected node
        var selectedNode = jm.get_selected_node();
        var selectedId = selectedNode ? selectedNode.id : null;

        // Save current scroll position
        var container = jm.view.e_panel;
        var scrollLeft = container ? container.scrollLeft : 0;
        var scrollTop = container ? container.scrollTop : 0;
        console.log('Saved scroll position:', scrollLeft, scrollTop);

        // Reload the data
        jm.show(data);

        // Re-setup the update_node override after reload
        if (jm && jm.update_node) {
            var originalUpdateNode = jm.update_node;
            jm.update_node = function (nodeid, topic) {
                var result = originalUpdateNode.call(jm, nodeid, topic);
                changedNodes.add(nodeid);
                console.log('Node changed after reload:', nodeid, 'New topic:', topic);

                // Auto-save immediately
                if (autoSaveTimeout) {
                    clearTimeout(autoSaveTimeout);
                }
                autoSaveTimeout = setTimeout(function () {
                    console.log('Auto-saving after node edit...');
                    autoSave();
                }, 300);

                return result;
            };
        }

        // Restore scroll position
        if (container) {
            container.scrollLeft = scrollLeft;
            container.scrollTop = scrollTop;
            console.log('Restored scroll position:', scrollLeft, scrollTop);
        }

        // Restore selection only if there was a selected node
        if (selectedId) {
            var node = jm.get_node(selectedId);
            if (node) {
                jm.select_node(selectedId);
                console.log('Restored selection:', selectedId);
            }
        }

        // Re-render math
        setTimeout(renderMath, 300);

        // Mark linked nodes after reload
        setTimeout(markLinkedNodes, 400);

        // Show success message
        showToast('Refreshed!');
        console.log('Map refreshed successfully');
    } catch (e) {
        console.error('Error reloading map:', e);
        alert('Error refreshing map: ' + e);
    }
}

// Show toast message
function showToast(message) {
    var status = document.getElementById('auto-save-status');
    if (status) {
        status.textContent = message;
        status.style.opacity = '1';
        setTimeout(function () {
            status.style.opacity = '0';
        }, 1500);
    }
}

function setupMultiSelection() {
    var container = document.getElementById('jsmind_container');

    container.addEventListener('mousedown', function (e) {
        if (e.button === 2 && e.ctrlKey) {
            isSelecting = true;
            selectionStart = { x: e.clientX, y: e.clientY };

            if (!selectionBox) {
                selectionBox = document.createElement('div');
                selectionBox.style.cssText = 'position:fixed; border:2px dashed #4dc4ff; background:rgba(77,196,255,0.1); pointer-events:none; z-index:9999;';
                document.body.appendChild(selectionBox);
            }

            selectionBox.style.left = e.clientX + 'px';
            selectionBox.style.top = e.clientY + 'px';
            selectionBox.style.width = '0px';
            selectionBox.style.height = '0px';
            selectionBox.style.display = 'block';

            e.preventDefault();
        }
    });

    document.addEventListener('mousemove', function (e) {
        if (isSelecting && selectionBox) {
            var width = Math.abs(e.clientX - selectionStart.x);
            var height = Math.abs(e.clientY - selectionStart.y);
            var left = Math.min(e.clientX, selectionStart.x);
            var top = Math.min(e.clientY, selectionStart.y);

            selectionBox.style.left = left + 'px';
            selectionBox.style.top = top + 'px';
            selectionBox.style.width = width + 'px';
            selectionBox.style.height = height + 'px';
        }
    });

    document.addEventListener('mouseup', function (e) {
        if (isSelecting) {
            isSelecting = false;
            if (selectionBox) {
                selectionBox.style.display = 'none';
            }

            selectNodesInBox(selectionStart.x, selectionStart.y, e.clientX, e.clientY);
        }
    });
}

function selectNodesInBox(x1, y1, x2, y2) {
    clearSelection();
    var nodes = document.querySelectorAll('jmnode');
    var minX = Math.min(x1, x2);
    var maxX = Math.max(x1, x2);
    var minY = Math.min(y1, y2);
    var maxY = Math.max(y1, y2);

    nodes.forEach(function (node) {
        var rect = node.getBoundingClientRect();
        if (rect.left >= minX && rect.right <= maxX &&
            rect.top >= minY && rect.bottom <= maxY) {
            node.classList.add('selected-multi');
            selectedNodes.push(node);
        }
    });
}

function clearSelection() {
    selectedNodes.forEach(function (node) {
        node.classList.remove('selected-multi');
    });
    selectedNodes = [];
}

function toggleArrowMode() {
    arrowMode = !arrowMode;
    if (arrowMode) {
        document.getElementById('jsmind_container').style.cursor = 'crosshair';
    } else {
        document.getElementById('jsmind_container').style.cursor = 'default';
        arrowStart = null;
    }
}

// Get all nodes at the same depth level and side, sorted by vertical position
function getNodesAtDepth(depth, filterSide) {
    var allNodes = [];

    function traverse(node, currentDepth) {
        if (currentDepth === depth) {
            var elem = document.querySelector('jmnode[nodeid="' + node.id + '"]');
            if (elem) {
                var rect = elem.getBoundingClientRect();
                allNodes.push({
                    node: node,
                    top: rect.top,
                    centerY: rect.top + rect.height / 2,
                    centerX: rect.left + rect.width / 2
                });
            }
        }

        if (node.children && currentDepth < depth) {
            for (var i = 0; i < node.children.length; i++) {
                var childId = (typeof node.children[i] === 'string') ? node.children[i] : node.children[i].id;
                var childNode = jm.get_node(childId);
                if (childNode) {
                    traverse(childNode, currentDepth + 1);
                }
            }
        }
    }

    var root = jm.get_root();
    traverse(root, 0);

    // Filter by side if specified
    if (filterSide !== null && filterSide !== undefined) {
        var rootElem = document.querySelector('jmnode[nodeid="' + root.id + '"]');
        if (rootElem) {
            var rootCenterX = rootElem.getBoundingClientRect().left + rootElem.getBoundingClientRect().width / 2;
            allNodes = allNodes.filter(function (item) {
                if (filterSide === 'left') {
                    return item.centerX < rootCenterX;
                } else if (filterSide === 'right') {
                    return item.centerX > rootCenterX;
                } else if (filterSide === 'center') {
                    return item.node.id === root.id;
                }
                return true;
            });
        }
    }

    // Sort by vertical position
    allNodes.sort(function (a, b) { return a.centerY - b.centerY; });
    return allNodes;
}

// Get node depth
function getNodeDepth(node) {
    var depth = 0;
    var current = node;
    while (current.parent) {
        depth++;
        current = jm.get_node(current.parent);
        if (!current) break;
    }
    return depth;
}

// Get node side relative to root
function getNodeSide(node) {
    if (node.isroot) return 'center';

    var root = jm.get_root();
    var rootElem = document.querySelector('jmnode[nodeid="' + root.id + '"]');
    var nodeElem = document.querySelector('jmnode[nodeid="' + node.id + '"]');

    if (!rootElem || !nodeElem) return null;

    var rootCenterX = rootElem.getBoundingClientRect().left + rootElem.getBoundingClientRect().width / 2;
    var nodeCenterX = nodeElem.getBoundingClientRect().left + nodeElem.getBoundingClientRect().width / 2;

    return nodeCenterX < rootCenterX ? 'left' : 'right';
}

// Get closest child by vertical distance
function getClosestChild(parentNode) {
    if (!parentNode.children || parentNode.children.length === 0) return null;

    var parentElem = document.querySelector('jmnode[nodeid="' + parentNode.id + '"]');
    if (!parentElem) return null;

    var parentRect = parentElem.getBoundingClientRect();
    var parentCenterY = parentRect.top + parentRect.height / 2;

    var closest = null;
    var minDist = Infinity;

    for (var i = 0; i < parentNode.children.length; i++) {
        var childId = (typeof parentNode.children[i] === 'string') ? parentNode.children[i] : parentNode.children[i].id;
        var childNode = jm.get_node(childId);
        if (!childNode) continue;

        var childElem = document.querySelector('jmnode[nodeid="' + childId + '"]');
        if (childElem) {
            var childRect = childElem.getBoundingClientRect();
            var childCenterY = childRect.top + childRect.height / 2;
            var dist = Math.abs(childCenterY - parentCenterY);

            if (dist < minDist || (dist === minDist && closest === null)) {
                minDist = dist;
                closest = childNode;
            }
        }
    }

    return closest;
}

// Scroll node into view smoothly (XMind-style)
function scrollToNode(nodeId) {
    var nodeElem = document.querySelector('jmnode[nodeid="' + nodeId + '"]');
    if (!nodeElem) return;

    // Get jsMind's scroll container (the actual panel that scrolls)
    var container = jm.view.e_panel;
    if (!container) {
        container = document.getElementById('jsmind_container');
    }
    if (!container) return;

    var nodeRect = nodeElem.getBoundingClientRect();
    var containerRect = container.getBoundingClientRect();

    // Calculate target scroll position to center the node
    var targetScrollLeft = container.scrollLeft + nodeRect.left - containerRect.left -
        (containerRect.width - nodeRect.width) / 2;
    var targetScrollTop = container.scrollTop + nodeRect.top - containerRect.top -
        (containerRect.height - nodeRect.height) / 2;

    var startScrollLeft = container.scrollLeft;
    var startScrollTop = container.scrollTop;
    var distanceLeft = targetScrollLeft - startScrollLeft;
    var distanceTop = targetScrollTop - startScrollTop;

    // Skip if already very close (within 5px)
    if (Math.abs(distanceLeft) < 5 && Math.abs(distanceTop) < 5) {
        return;
    }

    // Duration: 400ms for visible but smooth movement
    var duration = 400;
    var startTime = null;

    // Easing function: ease-out-cubic for natural deceleration
    function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    function animateScroll(currentTime) {
        if (!startTime) startTime = currentTime;
        var elapsed = currentTime - startTime;
        var progress = Math.min(elapsed / duration, 1);
        var eased = easeOutCubic(progress);

        container.scrollLeft = startScrollLeft + distanceLeft * eased;
        container.scrollTop = startScrollTop + distanceTop * eased;

        if (progress < 1) {
            requestAnimationFrame(animateScroll);
        }
    }

    requestAnimationFrame(animateScroll);
}

function navigateUp() {
    if (!jm) return;
    var selected = jm.get_selected_node();
    if (!selected) return;

    var depth = getNodeDepth(selected);
    var side = getNodeSide(selected);
    var nodesAtDepth = getNodesAtDepth(depth, side);

    var currentIndex = -1;
    for (var i = 0; i < nodesAtDepth.length; i++) {
        if (nodesAtDepth[i].node.id === selected.id) {
            currentIndex = i;
            break;
        }
    }

    if (currentIndex > 0) {
        var targetId = nodesAtDepth[currentIndex - 1].node.id;
        jm.select_node(targetId);
        scrollToNode(targetId);
    }
}

function navigateDown() {
    if (!jm) return;
    var selected = jm.get_selected_node();
    if (!selected) return;

    var depth = getNodeDepth(selected);
    var side = getNodeSide(selected);
    var nodesAtDepth = getNodesAtDepth(depth, side);

    var currentIndex = -1;
    for (var i = 0; i < nodesAtDepth.length; i++) {
        if (nodesAtDepth[i].node.id === selected.id) {
            currentIndex = i;
            break;
        }
    }

    if (currentIndex >= 0 && currentIndex < nodesAtDepth.length - 1) {
        var targetId = nodesAtDepth[currentIndex + 1].node.id;
        jm.select_node(targetId);
        scrollToNode(targetId);
    }
}

function navigateLeft() {
    if (!jm) return;
    var selected = jm.get_selected_node();
    if (!selected) return;

    // If at root, go to left-side closest child
    if (selected.isroot) {
        if (selected.children && selected.children.length > 0) {
            var rootElem = document.querySelector('jmnode[nodeid="' + selected.id + '"]');
            if (!rootElem) return;
            var rootRect = rootElem.getBoundingClientRect();
            var rootCenterX = rootRect.left + rootRect.width / 2;
            var rootCenterY = rootRect.top + rootRect.height / 2;

            var leftChildren = [];
            for (var i = 0; i < selected.children.length; i++) {
                var childId = (typeof selected.children[i] === 'string') ? selected.children[i] : selected.children[i].id;
                var childElem = document.querySelector('jmnode[nodeid="' + childId + '"]');
                if (childElem) {
                    var childRect = childElem.getBoundingClientRect();
                    var childCenterX = childRect.left + childRect.width / 2;
                    if (childCenterX < rootCenterX) {
                        var childCenterY = childRect.top + childRect.height / 2;
                        var dist = Math.abs(childCenterY - rootCenterY);
                        leftChildren.push({ id: childId, dist: dist });
                    }
                }
            }

            if (leftChildren.length > 0) {
                leftChildren.sort(function (a, b) { return a.dist - b.dist; });
                jm.select_node(leftChildren[0].id);
                scrollToNode(leftChildren[0].id);
            }
        }
        return;
    }

    // For non-root nodes: determine if on left or right side of root
    var side = getNodeSide(selected);

    if (side === 'left') {
        // Left side: left arrow goes to children
        var child = getClosestChild(selected);
        if (child) {
            jm.select_node(child.id);
            scrollToNode(child.id);
        }
    } else {
        // Right side: left arrow goes to parent
        if (selected.parent) {
            jm.select_node(selected.parent);
            scrollToNode(selected.parent.id);
        }
    }
}

function navigateRight() {
    if (!jm) return;
    var selected = jm.get_selected_node();
    if (!selected) return;

    // If at root, go to right-side closest child
    if (selected.isroot) {
        if (selected.children && selected.children.length > 0) {
            var rootElem = document.querySelector('jmnode[nodeid="' + selected.id + '"]');
            if (!rootElem) return;
            var rootRect = rootElem.getBoundingClientRect();
            var rootCenterX = rootRect.left + rootRect.width / 2;
            var rootCenterY = rootRect.top + rootRect.height / 2;

            var rightChildren = [];
            for (var i = 0; i < selected.children.length; i++) {
                var childId = (typeof selected.children[i] === 'string') ? selected.children[i] : selected.children[i].id;
                var childElem = document.querySelector('jmnode[nodeid="' + childId + '"]');
                if (childElem) {
                    var childRect = childElem.getBoundingClientRect();
                    var childCenterX = childRect.left + childRect.width / 2;
                    if (childCenterX > rootCenterX) {
                        var childCenterY = childRect.top + childRect.height / 2;
                        var dist = Math.abs(childCenterY - rootCenterY);
                        rightChildren.push({ id: childId, dist: dist });
                    }
                }
            }

            if (rightChildren.length > 0) {
                rightChildren.sort(function (a, b) { return a.dist - b.dist; });
                jm.select_node(rightChildren[0].id);
                scrollToNode(rightChildren[0].id);
            }
        }
        return;
    }

    // For non-root nodes: determine if on left or right side of root
    var side = getNodeSide(selected);

    if (side === 'left') {
        // Left side: right arrow goes to parent
        if (selected.parent) {
            jm.select_node(selected.parent);
            scrollToNode(selected.parent.id);
        }
    } else {
        // Right side: right arrow goes to children
        var child = getClosestChild(selected);
        if (child) {
            jm.select_node(child.id);
            scrollToNode(child.id);
        }
    }
}

// Add a capture-phase listener to intercept ALL keydown events when editing
document.addEventListener('keydown', function (e) {
    if (isEditing) {
        // Intercept ALL events in capture phase
        e.stopPropagation();
        e.stopImmediatePropagation();

        // Shift+Enter: allow new line
        if (e.key === 'Enter' && e.shiftKey) {
            // Let it pass through to create new line
            return;
        }

        // Enter without Shift: exit edit mode
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            exitEditMode();
        }
        // All other keys (including arrows) work normally in the input
        return;
    }
}, true);  // Use capture phase!

// Regular event listener for non-editing mode
document.addEventListener('keydown', function (e) {
    // Skip if editing
    if (isEditing) {
        return;
    }

    // Handle floating node deletion
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedFloatingNode) {
        if (jm && !jm.get_editable()) return;
        e.preventDefault();
        console.log('Global delete handler - deleting floating node:', selectedFloatingNode.id);
        removeFloatingNode(selectedFloatingNode);
        selectedFloatingNode = null;
        saveHistory();
        scheduleAutoSave();
        return;
    }

    if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigateUp();
        return;
    }

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigateDown();
        return;
    }

    if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateLeft();
        return;
    }

    if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateRight();
        return;
    }


    // Save hotkey
    if (matchHotkey(e, hotkeyConfig.save)) {
        e.preventDefault();
        saveMap();
        return;
    }

    // Refresh hotkey
    if (matchHotkey(e, hotkeyConfig.refresh)) {
        e.preventDefault();
        refreshMap();
        return;
    }

    // Focus root hotkey
    if (matchHotkey(e, hotkeyConfig.focus_root)) {
        e.preventDefault();
        if (jm) {
            var root = jm.get_root();
            if (root) {
                jm.select_node(root.id);
                scrollToNode(root.id);
            }
        }
        return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        if (jm && !jm.get_editable()) return;
        e.preventDefault();
        undo();
        return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        if (jm && !jm.get_editable()) return;
        e.preventDefault();
        redo();
        return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault();
        toggleArrowMode();
        return;
    }

    if (!jm) return;
    var selected = jm.get_selected_node();
    if (!selected) return;

    if (!jm.get_editable() && (e.key === ' ' || e.key === 'Enter' || e.key === 'Tab' || e.key === 'Delete' || e.key === 'Backspace')) {
        return;
    }

    // Space key: Enter edit mode
    if (e.key === ' ' && !isEditing) {
        e.preventDefault();
        enterEditMode(selected);
        return;
    }

    // Enter key behavior depends on whether we're editing
    if (e.key === 'Enter') {
        e.preventDefault();
        if (isEditing) {
            // Exit edit mode
            exitEditMode();
        } else {
            // Add sibling (original behavior)
            addSibling();
        }
        return;
    }

    if (e.key === 'Tab') {
        e.preventDefault();
        addChild();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (selected && !selected.isroot) {
            jm.remove_node(selected);
            saveHistory();
            scheduleAutoSave();
        }
    }
});

document.addEventListener('blur', function (e) {
    if (e.target.id === 'input-box') {
        saveHistory();
        scheduleAutoSave();
    }
}, true);

// Enter edit mode for a node
function enterEditMode(node) {
    if (!node || isEditing) return;

    isEditing = true;
    editingNodeId = node.id;

    // Get the node element directly
    var nodeElement = document.querySelector('jmnode[nodeid="' + node.id + '"]');
    if (!nodeElement) {
        isEditing = false;
        editingNodeId = null;
        return;
    }

    // Get current content and convert <br> to newlines
    var currentContent = node.topic;
    var plainText = currentContent.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');

    // Store original HTML
    var originalHTML = nodeElement.innerHTML;

    // Clear node and prepare for editing
    nodeElement.innerHTML = '';
    nodeElement.style.padding = '0';
    nodeElement.style.display = 'inline-block';

    // Create textarea
    var textarea = document.createElement('textarea');
    textarea.id = 'input-box';
    textarea.value = plainText;

    // Get computed styles from node
    var computedStyle = window.getComputedStyle(nodeElement);

    // Apply styles to textarea
    textarea.style.cssText = `
        box-sizing: border-box;
        margin: 0;
        padding: 8px;
        border: 2px solid #4A90E2;
        border-radius: 4px;
        outline: none;
        background: #fff;
        font-family: ${computedStyle.fontFamily};
        font-size: ${computedStyle.fontSize};
        font-weight: ${computedStyle.fontWeight};
        color: #000;
        line-height: 1.5;
        resize: none;
        overflow: hidden;
        white-space: pre-wrap;
        word-wrap: break-word;
        min-width: 120px;
        min-height: 30px;
        max-width: 500px;
    `;

    // Add textarea to node
    nodeElement.appendChild(textarea);

    // Auto-resize function - REAL-TIME
    function autoResize() {
        if (!textarea || !textarea.parentNode) return;

        // Create hidden div for measurement
        var measureDiv = document.createElement('div');
        measureDiv.style.cssText = `
            position: absolute;
            visibility: hidden;
            white-space: pre-wrap;
            word-wrap: break-word;
            font-family: ${textarea.style.fontFamily};
            font-size: ${textarea.style.fontSize};
            font-weight: ${textarea.style.fontWeight};
            line-height: ${textarea.style.lineHeight};
            padding: ${textarea.style.padding};
            border: ${textarea.style.border};
            box-sizing: border-box;
            max-width: 500px;
        `;
        measureDiv.textContent = textarea.value || 'W';
        document.body.appendChild(measureDiv);

        var width = Math.max(120, Math.min(500, measureDiv.offsetWidth));
        var height = Math.max(30, measureDiv.offsetHeight);
        document.body.removeChild(measureDiv);

        // Apply to both textarea and node
        textarea.style.width = width + 'px';
        textarea.style.height = height + 'px';
        nodeElement.style.width = width + 'px';
        nodeElement.style.height = height + 'px';

        console.log('Resized:', width, 'x', height);
    }

    textarea.focus();
    textarea.select();
    setTimeout(autoResize, 10);

    // Keydown handler
    textarea.addEventListener('keydown', function (e) {
        e.stopPropagation();
        e.stopImmediatePropagation();

        // Shift+Enter: insert newline manually
        if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            var start = textarea.selectionStart;
            var end = textarea.selectionEnd;
            textarea.value = textarea.value.substring(0, start) + '\n' + textarea.value.substring(end);
            textarea.selectionStart = textarea.selectionEnd = start + 1;
            setTimeout(autoResize, 0);
            console.log('Newline inserted');
            return false;
        }

        // Enter: exit
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            exitEditMode();
            return false;
        }

        // Escape: cancel
        if (e.key === 'Escape') {
            e.preventDefault();
            nodeElement.innerHTML = originalHTML;
            nodeElement.style.width = '';
            nodeElement.style.height = '';
            nodeElement.style.padding = '';
            isEditing = false;
            editingNodeId = null;
            document.getElementById('jsmind_container').focus();
            return false;
        }

        setTimeout(autoResize, 0);
    }, true);

    // Input handler - resize on every input
    textarea.addEventListener('input', function (e) {
        e.stopPropagation();
        autoResize();
    }, true);

    textarea.addEventListener('paste', function () {
        setTimeout(autoResize, 10);
    }, true);

    textarea.addEventListener('mousedown', function (e) {
        e.stopPropagation();
        e.stopImmediatePropagation();
    }, true);

    textarea.addEventListener('click', function (e) {
        e.stopPropagation();
        e.stopImmediatePropagation();
    }, true);
}

// Exit edit mode
function exitEditMode() {
    if (!isEditing) return;

    var inputBox = document.getElementById('input-box');
    if (!inputBox || !editingNodeId) {
        isEditing = false;
        editingNodeId = null;
        return;
    }

    var newText = inputBox.value;
    var node = jm.get_node(editingNodeId);

    if (node) {
        var nodeElement = document.querySelector('jmnode[nodeid="' + editingNodeId + '"]');

        if (nodeElement) {
            nodeElement.innerHTML = '';
            nodeElement.style.width = '';
            nodeElement.style.height = '';
            nodeElement.style.padding = '';
            nodeElement.style.whiteSpace = 'normal';
            nodeElement.style.wordWrap = 'break-word';
            nodeElement.style.display = 'inline-block';
            nodeElement.style.maxWidth = '500px';

            if (newText && newText.trim() !== '') {
                // Convert newlines to <br> for display
                var htmlText = newText.replace(/\n/g, '<br>');
                jm.update_node(editingNodeId, htmlText);

                if (jm.view.opts.support_html) {
                    nodeElement.innerHTML = htmlText;
                } else {
                    nodeElement.textContent = htmlText;
                }
            } else {
                if (jm.view.opts.support_html) {
                    nodeElement.innerHTML = node.topic;
                } else {
                    nodeElement.textContent = node.topic;
                }
            }
        }
    }

    isEditing = false;
    editingNodeId = null;

    var container = document.getElementById('jsmind_container');
    if (container) container.focus();

    saveHistory();

    // Auto-save immediately and refresh to fix position
    console.log('Auto-saving after edit...');
    autoSave();

    // Trigger refresh after a brief delay to allow save to complete
    setTimeout(function () {
        console.log('Auto-refreshing to fix node position...');
        refreshMap();
    }, 100);

    setTimeout(renderMath, 300);
}

// Handle clicks during edit mode - capture phase to intercept early
document.addEventListener('mousedown', function (e) {
    if (isEditing && editingNodeId) {
        console.log('Mousedown in edit mode, target:', e.target);

        // Get the node element being edited
        var node = jm.get_node(editingNodeId);
        if (node && node._data && node._data.view) {
            var nodeElement = node._data.view.element;
            console.log('Node element:', nodeElement);
            console.log('Contains target?', nodeElement.contains(e.target));

            // Check if click is inside the node element (which contains the input box)
            if (nodeElement && nodeElement.contains(e.target)) {
                // Click inside node/input - allow normal behavior (cursor positioning)
                console.log('Click inside node - allowing');
                e.stopPropagation();
                e.stopImmediatePropagation();
                return;
            }
        }

        // Click outside node - exit edit mode
        console.log('Click outside node - exiting edit mode');
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        exitEditMode();
        return;
    }
}, true);

// Also handle click events to prevent any unwanted behavior
document.addEventListener('click', function (e) {
    if (isEditing && editingNodeId) {
        var node = jm.get_node(editingNodeId);
        if (node && node._data && node._data.view) {
            var nodeElement = node._data.view.element;

            // Only allow clicks inside the node element
            if (!nodeElement || !nodeElement.contains(e.target)) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                return;
            }
        }
        // Click inside - stop propagation
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
    }
}, true);

// Regular click handler for non-editing mode
document.addEventListener('click', function (e) {
    // Don't interfere if editing
    if (isEditing) {
        return;
    }

    var container = document.getElementById('jsmind_container');
    if (container) container.focus();

    if (!e.ctrlKey && !e.shiftKey) {
        clearSelection();
    }
});

// --- Card Linking Features ---

// Focus a node by ID
function focusNode(nodeId) {
    if (!jm) return;
    var node = jm.get_node(nodeId);
    if (node) {
        jm.select_node(nodeId);
        var element = jm.view.get_node_element(node);
        if (element) {
            element.scrollIntoView({ block: "center", inline: "center" });
            // Add a visual highlight effect
            element.style.transition = "box-shadow 0.5s";
            element.style.boxShadow = "0 0 20px #ffeb3b";
            setTimeout(function () {
                element.style.boxShadow = "";
            }, 2000);
        }
    }
}

// Context Menu for Jumping to Card
document.addEventListener('contextmenu', function (e) {
    var target = e.target;
    // Find if we clicked on a node
    var nodeElement = target.closest('jmnode');
    if (nodeElement) {
        var nodeId = nodeElement.getAttribute('nodeid');
        var node = jm.get_node(nodeId);
        // Check both direct property and data property just in case
        var noteId = (node.data && node.data.noteId) || node.noteId;

        if (noteId) {
            e.preventDefault();
            showContextMenu(e.clientX, e.clientY, noteId);
        }
    }
});

function showContextMenu(x, y, noteId) {
    // Remove existing menu
    var existing = document.getElementById('custom-context-menu');
    if (existing) existing.remove();

    var menu = document.createElement('div');
    menu.id = 'custom-context-menu';
    menu.style.cssText = `
        position: fixed;
        left: ${x}px;
        top: ${y}px;
        background: white;
        border: 1px solid #ccc;
        box-shadow: 2px 2px 5px rgba(0,0,0,0.2);
        z-index: 10000;
        padding: 5px 0;
        border-radius: 4px;
        min-width: 120px;
    `;

    var item = document.createElement('div');
    item.innerText = "Jump to Card";
    item.style.cssText = `
        padding: 8px 15px;
        cursor: pointer;
        font-family: sans-serif;
        font-size: 14px;
        color: #333;
    `;
    item.onmouseover = function () { this.style.background = '#f0f0f0'; };
    item.onmouseout = function () { this.style.background = 'white'; };
    item.onclick = function () {
        pycmd("jump_to_card:" + noteId);
        menu.remove();
    };

    menu.appendChild(item);
    document.body.appendChild(menu);

    // Close on click elsewhere
    var closeHandler = function (e) {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
}


// Focus on a specific node and scroll it into view
function focusNode(nodeId) {
    if (!jm || !nodeId) {
        console.log('Cannot focus node: jm not initialized or no nodeId');
        return;
    }

    try {
        console.log('Focusing on node:', nodeId);

        // Select the node
        jm.select_node(nodeId);

        // Get the node element
        var nodeElement = document.querySelector('jmnode[nodeid="' + nodeId + '"]');
        if (!nodeElement) {
            console.log('Node element not found:', nodeId);
            return;
        }

        // Scroll the node into view with smooth animation
        nodeElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'center'
        });

        console.log('Node focused and scrolled into view');
    } catch (e) {
        console.error('Error focusing node:', e);
    }
}

document.addEventListener('paste', function (e) {
    if (isEditing) return;
    if (jm && !jm.get_editable()) return;

    var selected = jm.get_selected_node();
    if (selected) {
        e.preventDefault();

        var text = (e.clipboardData || window.clipboardData).getData('text');

        if (text && text.trim() !== "") {

            var newId = 'node_' + Date.now();

            jm.add_node(selected, newId, text);

            jm.select_node(newId);

            if (typeof window.saveHistory === 'function') {
                window.saveHistory();
                scheduleAutoSave();
            }

            if (typeof renderMath === 'function') {
                setTimeout(renderMath, 100);
            }
        }
    }
});

document.addEventListener('copy', function (e) {
    if (isEditing) return;

    var selected = jm.get_selected_node();
    if (selected) {
        var text = selected.topic;

        if (text) {
            e.preventDefault();

            var plainText = text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');

            if (e.clipboardData) {
                e.clipboardData.setData('text/plain', plainText);
            } else if (window.clipboardData) {
                window.clipboardData.setData('Text', plainText);
            }
        }
    }
});

function toggleReadOnly() {
    if (!jm) return;
    var checkbox = document.getElementById('readonly_toggle');
    if (checkbox.checked) {
        jm.disable_edit();
    } else {
        jm.enable_edit();
    }
}
