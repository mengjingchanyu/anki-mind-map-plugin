import json
import os
import base64
from aqt import mw
from aqt.qt import *
from aqt.webview import AnkiWebView
from .note_manager import get_or_create_mindmap_model

class MindMapDialog(QDialog):
    @classmethod
    def open_instance(cls, mw, note_id, focus_node_id=None):
        """Unified window management: open or focus existing mindmap window"""
        # Initialize editor list
        if not hasattr(mw, 'mindmap_editors'):
            mw.mindmap_editors = []
        
        # Check if already open
        for editor in mw.mindmap_editors:
            if editor.note_id == note_id:
                editor.show()
                editor.raise_()
                editor.activateWindow()
                # Focus on specific node if needed
                if focus_node_id:
                    editor.web.eval(f"if(typeof focusNode === 'function') focusNode('{focus_node_id}');")
                return editor
        
        # Create new window
        dialog = cls(mw, note_id, focus_node_id)
        mw.mindmap_editors.append(dialog)
        dialog.show()
        
        # Remove from list when window closes
        dialog.finished.connect(lambda: mw.mindmap_editors.remove(dialog) if dialog in mw.mindmap_editors else None)
        
        return dialog
    
    def __init__(self, mw, note_id, focus_node_id=None):
        super().__init__(None)
        self.setWindowFlags(Qt.WindowType.Window)
        self.mw = mw
        self.note_id = note_id
        self.focus_node_id = focus_node_id
        self.note = mw.col.get_note(note_id)
        self.setWindowTitle(f"Mind Map Editor - {self.note['Title']}")
        self.resize(1024, 768)
        
        # Save this as last opened mind map
        config = mw.addonManager.getConfig(__name__) or {}
        config['last_mindmap_id'] = note_id
        mw.addonManager.writeConfig(__name__, config)
        
        # Validate and clean up orphaned links before opening
        from . import card_linker
        card_linker.validate_and_cleanup_mindmap(self.note)
        self._cleanup_orphaned_links()
        
        self.layout = QVBoxLayout(self)
        self.layout.setContentsMargins(0, 0, 0, 0)
        
        # Initialize WebView
        self.web = AnkiWebView(parent=self)
        self.web.set_bridge_command(self._on_bridge_cmd, self)
        self.layout.addWidget(self.web)
        
        # Load the editor assets
        addon_dir = os.path.dirname(__file__)
        web_dir = os.path.join(addon_dir, "web")
        
        def read_asset(filename):
            with open(os.path.join(web_dir, filename), 'r', encoding='utf-8') as f:
                return f.read()

        try:
            # Load jsMind assets
            jsmind_js = read_asset("jsmind.js")
            jsmind_draggable = read_asset("jsmind.draggable.js")
            jsmind_css = read_asset("jsmind.css")
            style_css = read_asset("style.css")
            main_js = read_asset("main.js")
            
            # Prepare data for injection
            data_json = self.note['Data']
            if not data_json:
                data_json = "{}"
            
            # Load background image if configured
            bg_style = ""
            config = mw.addonManager.getConfig(__name__) or {}
            bg_filename = config.get('background_image', '')
            if bg_filename:
                bg_path = os.path.join(addon_dir, 'backgrounds', bg_filename)
                if os.path.exists(bg_path):
                    try:
                        with open(bg_path, 'rb') as img_file:
                            img_data = base64.b64encode(img_file.read()).decode('utf-8')
                            ext = os.path.splitext(bg_filename)[1].lower()
                            mime_type = 'image/jpeg' if ext in ['.jpg', '.jpeg'] else 'image/png'
                            
                            overlay = config.get('background_overlay', '')
                            if overlay:
                                bg_css = f"linear-gradient({overlay}, {overlay}), url(data:{mime_type};base64,{img_data})"
                            else:
                                bg_css = f"url(data:{mime_type};base64,{img_data})"

                            bg_style = f"""
                            .jsmind-inner {{
                                background-image: {bg_css} !important;
                            }}
                            """
                    except Exception as e:
                        print(f"Error loading background image: {e}")
            
            # Construct HTML with inlined assets and data
            html = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                {jsmind_css}
                {style_css}
                {bg_style}
                
                /* Reset body margins for fullscreen */
                html, body {{
                    margin: 0;
                    padding: 0;
                    width: 100%;
                    height: 100%;
                    overflow: hidden;
                }}
                
                /* Fullscreen container styles */
                #jsmind_container {{
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    margin: 0;
                    padding: 0;
                }}
                
                /* Ensure fullscreen fills entire screen */
                :fullscreen,
                :-webkit-full-screen,
                :-moz-full-screen,
                :-ms-fullscreen {{
                    width: 100%;
                    height: 100%;
                    margin: 0;
                    padding: 0;
                }}
                
                :fullscreen #jsmind_container,
                :-webkit-full-screen #jsmind_container,
                :-moz-full-screen #jsmind_container,
                :-ms-fullscreen #jsmind_container {{
                    width: 100vw;
                    height: 100vh;
                }}
                
                .toolbar {{
                    position: fixed;
                    top: 10px;
                    left: 10px;
                    z-index: 1000;
                    background: white;
                    padding: 8px;
                    border-radius: 4px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }}
                .toolbar button {{
                    padding: 8px 12px;
                    margin-right: 5px;
                    background: #28a745;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: bold;
                }}
                .toolbar button:hover {{
                    background: #218838;
                }}
                                #auto-save-status {{
                    position: fixed;
                    top: 55px;
                    right: 10px;
                    padding: 5px 10px;
                    background: rgba(40, 167, 69, 0.9);
                    color: white;
                    border-radius: 3px;
                    font-size: 12px;
                    opacity: 0;
                    transition: opacity 0.3s;
                    z-index: 1000;
                }}
                /* Floating nodes styles */
                jmnode[nodeid^="floating_"] {{
                    transition: border-color 0.2s, box-shadow 0.2s;
                }}
                jmnode[nodeid^="floating_"]:hover {{
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
                }}
                jmnode[nodeid^="floating_"].attaching {{
                    border-color: #4dc4ff !important;
                    animation: pulse 0.5s infinite;
                }}
                @keyframes pulse {{
                    0%, 100% {{ transform: scale(1); }}
                    50% {{ transform: scale(1.05); }}
                }}
                </style>
                <!-- MathJax from CDN with configuration -->
                <script>
                window.MathJax = {{
                    tex: {{
                        inlineMath: [['\\\\(', '\\\\)'], ['$', '$']],
                        displayMath: [['\\\\[', '\\\\]'], ['$$', '$$']]
                    }},
                    svg: {{
                        fontCache: 'global'
                    }}
                }};
                </script>
                <script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js" async></script>
                <script>
                {jsmind_js}
                </script>
                <script>
                {jsmind_draggable}
                </script>
            </head>
            <body>
                <div class="toolbar">
                    <button onclick="toggleFullscreen()" id="fullscreen-btn" title="Toggle Fullscreen" style="background: #6c757d; padding: 4px 8px; font-size: 12px;">⛶</button>
                </div>
                
                                                <div id="jsmind_container" tabindex="0" style="background: #f4f4f4; outline: none; overflow: auto;">
                </div>
                
                <div id="auto-save-status">Auto-saved</div>
                

                
                <script>
                {main_js}
                </script>
                
                <script>
                // Inject hotkey configuration
                var hotkeyConfigFromPython = {json.dumps(config.get('hotkeys', {}))};
                var lineColorFromPython = {json.dumps(config.get('line_color', 'rgba(139, 92, 246, 0.6)'))};
                if (hotkeyConfigFromPython && Object.keys(hotkeyConfigFromPython).length > 0) {{
                    hotkeyConfig = hotkeyConfigFromPython;
                    console.log("Loaded hotkey config:", hotkeyConfig);
                }}
                
                // Inject data directly
                var initialData = {data_json};
                var initialFocusId = "{self.focus_node_id or ''}";
                
                window.onload = function() {{
                    console.log("Window loaded. Starting init...");
                    if (typeof initEditor === 'function') {{
                        initEditor(initialData);
                        
                        if (initialFocusId) {{
                            setTimeout(function() {{
                                if (typeof focusNode === 'function') {{
                                    focusNode(initialFocusId);
                                }}
                            }}, 800);
                        }}
                    }} else {{
                        console.error("Error: initEditor function not found!");
                    }}
                }};
                </script>
            </body>
                        </html>
            """
            
            # Set base URL
            base_url = QUrl.fromLocalFile(os.path.join(web_dir, "index.html"))
            self.web.setHtml(html, base_url)

            self.undo_shortcut = QShortcut(QKeySequence("Ctrl+Z"), self)
            self.undo_shortcut.activated.connect(lambda: self.web.eval("window.undo();"))

            self.redo_shortcut = QShortcut(QKeySequence("Ctrl+Y"), self)
            self.redo_shortcut.activated.connect(lambda: self.web.eval("window.redo();"))
            
            self.redo_shortcut_alt = QShortcut(QKeySequence("Ctrl+Shift+Z"), self)
            self.redo_shortcut_alt.activated.connect(lambda: self.web.eval("window.redo();"))
            
        except Exception as e:
            self.web.setHtml(f"<h1>Error loading assets: {e}</h1>")

    def _on_bridge_cmd(self, cmd: str) -> None:
        if cmd.startswith("save:"):
            self._handle_save(cmd[5:])
        elif cmd == "close":
            self.close()
        elif cmd.startswith("jump_to_card:"):
            self._handle_jump_to_card(cmd[13:])
        elif cmd == "refresh_data":
            self._handle_refresh()
        elif cmd == "toggle_fullscreen":
            self._handle_toggle_fullscreen()
        else:
            print(f"Unknown command: {cmd}")

    def _handle_jump_to_card(self, note_id_str):
        try:
            nid = int(note_id_str)
            
            # Validate: Check if card still exists
            try:
                card_note = self.mw.col.get_note(nid)
                # Card exists, open browser
                from aqt import dialogs
                browser = dialogs.open("Browser", self.mw)
                browser.search_for(f"nid:{nid}")
            except:
                # Card doesn't exist, show error and cleanup
                from aqt.utils import showInfo
                showInfo("This card no longer exists. Cleaning up link...")
                
                # Find and remove noteId from the node
                import json
                data_str = self.note['Data']
                data = json.loads(data_str)
                
                modified = False
                def remove_noteid_from_node(node):
                    nonlocal modified
                    if isinstance(node, dict):
                        if node.get('noteId') == nid:
                            del node['noteId']
                            modified = True
                            print(f"Removed noteId {nid} from node {node.get('id')}")
                        if 'children' in node:
                            for child in node['children']:
                                remove_noteid_from_node(child)
                
                if 'data' in data:
                    remove_noteid_from_node(data['data'])
                
                if modified:
                    self.note['Data'] = json.dumps(data)
                    self.mw.col.update_note(self.note)
                    # Refresh the display to remove marker
                    self.web.eval("if(typeof markLinkedNodes === 'function') markLinkedNodes();")
                
        except ValueError:
            print(f"Invalid note ID for jump: {note_id_str}")


    def _handle_toggle_fullscreen(self):
        """Toggle fullscreen mode"""
        if self.isFullScreen():
            self.showNormal()
        else:
            self.showFullScreen()


    def _cleanup_orphaned_links(self):
        """Remove links from cards that point to non-existent nodes, and remove noteId from nodes whose cards are deleted"""
        try:
            # Get all node IDs from the mindmap
            data_str = self.note['Data']
            if not data_str:
                return
            
            data = json.loads(data_str)
            existing_node_ids = set()
            nodes_with_note_ids = {}  # node_id -> noteId mapping
            
            # Recursively collect all node IDs and noteIds
            def collect_node_info(node):
                if isinstance(node, dict):
                    if 'id' in node:
                        existing_node_ids.add(node['id'])
                        if 'noteId' in node:
                            nodes_with_note_ids[node['id']] = node['noteId']
                    if 'children' in node:
                        for child in node['children']:
                            collect_node_info(child)
            
            if 'data' in data:
                collect_node_info(data['data'])
            
            # Part 1: Clean up orphaned links in cards (node was deleted)
            all_notes = self.mw.col.find_notes(f'data-mid="{self.note_id}"')
            
            cleaned_card_count = 0
            for nid in all_notes:
                try:
                    card_note = self.mw.col.get_note(nid)
                    modified = False
                    
                    # Check all fields for the mindmap link
                    for field_name in card_note.keys():
                        field_content = card_note[field_name]
                        
                        # Look for mindmap-link divs
                        import re
                        pattern = r'<div id="mindmap-link"\s+data-mid="(\d+)"\s+data-nid="([^"]+)"\s+style="display:none;">\s*</div>'
                        
                        def check_and_remove(match):
                            nonlocal modified
                            mid = match.group(1)
                            node_id = match.group(2)
                            
                            # If this link points to our mindmap
                            if mid == str(self.note_id):
                                # Check if the node still exists
                                if node_id not in existing_node_ids:
                                    # Node doesn't exist, remove this link
                                    modified = True
                                    print(f"Removing orphaned link to node {node_id} from card {nid}")
                                    return ""  # Remove the div
                            
                            return match.group(0)  # Keep the div
                        
                        new_content = re.sub(pattern, check_and_remove, field_content)
                        if new_content != field_content:
                            card_note[field_name] = new_content
                    
                    if modified:
                        self.mw.col.update_note(card_note)
                        cleaned_card_count += 1
                        
                except Exception as e:
                    print(f"Error cleaning card {nid}: {e}")
            
            # Part 2: Clean up noteId from nodes whose cards are deleted
            orphaned_note_ids = []
            for node_id, note_id in nodes_with_note_ids.items():
                try:
                    # Try to get the card
                    card_note = self.mw.col.get_note(note_id)
                    # Card exists, check if it still has the link to this mindmap
                    has_link = False
                    for field_name in card_note.keys():
                        if f'data-mid="{self.note_id}"' in card_note[field_name]:
                            has_link = True
                            break
                    
                    if not has_link:
                        # Card exists but link was removed, clean up noteId
                        orphaned_note_ids.append(node_id)
                        
                except Exception:
                    # Card doesn't exist, mark for cleanup
                    orphaned_note_ids.append(node_id)
            
            # Remove noteId from nodes
            if orphaned_note_ids:
                def remove_note_ids(node):
                    if isinstance(node, dict):
                        if 'id' in node and node['id'] in orphaned_note_ids:
                            if 'noteId' in node:
                                del node['noteId']
                                print(f"Removed orphaned noteId from node {node['id']}")
                        if 'children' in node:
                            for child in node['children']:
                                remove_note_ids(child)
                
                if 'data' in data:
                    remove_note_ids(data['data'])
                    # Save the updated mindmap
                    self.note['Data'] = json.dumps(data)
                    self.mw.col.update_note(self.note)
            
            if cleaned_card_count > 0 or orphaned_note_ids:
                print(f"Cleanup complete: {cleaned_card_count} card links removed, {len(orphaned_note_ids)} node noteIds removed")
                
        except Exception as e:
            print(f"Error during cleanup: {e}")


    def _handle_save(self, payload_json: str):
        try:
            payload = json.loads(payload_json)
            data = payload.get("data")
            image_html = payload.get("image_html")
            floating_nodes = payload.get("floatingNodes", [])
            changed_nodes = payload.get("changedNodes", [])  # Added: receive changed nodes
            
            print(f"DEBUG: Received changed_nodes: {changed_nodes}")
            
            # Combine mind map data with floating nodes
            if data:
                if isinstance(data, dict):
                    data['floatingNodes'] = floating_nodes
                # Log data to save before saving (for debugging)
                new_data_json = json.dumps(data)
                print(f"DEBUG: About to save data, length: {len(new_data_json)}, root topic: {data.get('data', {}).get('topic', 'N/A')}")
                
                self.note['Data'] = new_data_json
            
            if image_html:
                self.note['DisplayHTML'] = f"<div class='mindmap-static'>{image_html}</div>"
            
            # Save note
            self.mw.col.update_note(self.note)
            
            # Force flush to database to ensure data is written
            self.mw.col.flush()
            
            # Verify data was saved (reload)
            verification_note = self.mw.col.get_note(self.note_id)
            verification_data = verification_note['Data']
            print(f"DEBUG: Data saved and verified, length: {len(verification_data)}")
            if verification_data != self.note['Data']:
                print("WARNING: Saved data differs from what we tried to save!")
            else:
                print("DEBUG: Data verified - matches what we saved")
            
            # Sync changed nodes to linked cards
            if changed_nodes:
                print(f"DEBUG: Syncing {len(changed_nodes)} changed nodes to cards")
                self._sync_nodes_to_cards(changed_nodes)
            else:
                print("DEBUG: No changed nodes to sync")
            
            # Don't reset immediately, wait for sync to complete
            self.mw.reset()
            
            self.web.eval("if(typeof showToast === 'function') showToast('Saved!');")
            
        except Exception as e:
            print(f"Error saving: {e}")
            import traceback
            traceback.print_exc()
            self.web.eval(f"if(typeof showToast === 'function') showToast('Error: {e}');")

    
    def _sync_nodes_to_cards(self, changed_nodes):
        """Sync changed node content to linked cards"""
        import re
        # Import cycle prevention flag
        from . import card_linker
        
        for node_info in changed_nodes:
            node_id = node_info.get('id')
            new_topic = node_info.get('topic', '')
            note_id = node_info.get('noteId')
            
            if not note_id or not new_topic:
                continue
            
            try:
                # Prevent sync loop
                card_linker._syncing_from_node = True
                
                # Get linked card
                card_note = self.mw.col.get_note(note_id)
                
                # Check if card has Front field
                if 'Front' not in card_note:
                    continue
                
                # Get current front content
                front_content = card_note['Front']
                
                # Extract first line
                front_text = re.sub(r'<br\s*/?>', '\n', front_content, flags=re.IGNORECASE)
                clean_text = re.sub('<[^<]+?>', '', front_text)
                lines = clean_text.split('\n')
                first_line = lines[0].strip() if lines else ''
                
                # Update if first line differs from node content
                if first_line != new_topic:
                    # Replace first line, keep rest
                    # Need to preserve HTML format
                    if '<br' in front_content.lower():
                        # Has newline
                        parts = re.split(r'<br\s*/?>', front_content, maxsplit=1, flags=re.IGNORECASE)
                        if len(parts) > 1:
                            card_note['Front'] = new_topic + '<br>' + parts[1]
                        else:
                            card_note['Front'] = new_topic
                    else:
                        # No newline, replace entire
                        card_note['Front'] = new_topic
                    
                    self.mw.col.update_note(card_note)
                    print(f"Synced mindmap node to card: '{first_line}' -> '{new_topic}'")
                    
            except Exception as e:
                print(f"Error syncing node {node_id} to card {note_id}: {e}")
            finally:
                card_linker._syncing_from_node = False

    def _handle_refresh(self):
        """Refresh mindmap data"""
        try:
            print(f"DEBUG: Refresh requested for note {self.note_id}")
            
            # Force reload latest data from database
            # Clear possible cache first
            self.mw.col.flush()
            
            # Completely re-fetch note (don't use self.note)
            fresh_note = self.mw.col.get_note(self.note_id)
            data_str = fresh_note['Data']
            
            print(f"DEBUG: Loaded fresh data, length: {len(data_str)}")
            
            # Parse to check root topic
            try:
                import json
                parsed_data = json.loads(data_str)
                root_topic = parsed_data.get('data', {}).get('topic', 'N/A')
                print(f"DEBUG: Root topic in fresh data: {root_topic}")
            except:
                pass
            
            # Update self.note with latest data
            self.note = fresh_note
            
            # Send to JavaScript
            js_code = f"if(typeof reloadMapData === 'function') reloadMapData({data_str});"
            self.web.eval(js_code)
            print("DEBUG: Refresh command sent to JavaScript")
        except Exception as e:
            print(f"Error refreshing: {e}")
            import traceback
            traceback.print_exc()

    def closeEvent(self, event):
        event.accept()

