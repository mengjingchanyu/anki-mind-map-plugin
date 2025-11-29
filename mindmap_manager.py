from aqt import mw
from aqt.qt import *
from aqt.utils import showInfo, getText, askUser
from .note_manager import create_new_mindmap_note, get_or_create_mindmap_model
from .mindmap_editor import MindMapDialog
import uuid

class MindMapManager(QDialog):
    def __init__(self, mw):
        super().__init__(mw)
        self.mw = mw
        self.setWindowTitle("Mind Map Manager")
        self.resize(600, 400)
        
        self.layout = QVBoxLayout(self)
        
        # List Widget
        self.list_widget = QListWidget()
        self.list_widget.itemDoubleClicked.connect(self.on_open)
        self.layout.addWidget(self.list_widget)
        
        # Buttons
        btn_layout = QHBoxLayout()
        
        btn_new = QPushButton("New")
        btn_new.clicked.connect(self.on_new)
        btn_layout.addWidget(btn_new)
        
        btn_open = QPushButton("Open")
        btn_open.clicked.connect(self.on_open)
        btn_layout.addWidget(btn_open)
        
        btn_rename = QPushButton("Rename")
        btn_rename.clicked.connect(self.on_rename)
        btn_layout.addWidget(btn_rename)
        
        btn_delete = QPushButton("Delete")
        btn_delete.clicked.connect(self.on_delete)
        btn_layout.addWidget(btn_delete)
        
        btn_toggle = QPushButton("Toggle Active")
        btn_toggle.clicked.connect(self.on_toggle_active)
        btn_layout.addWidget(btn_toggle)
        
        btn_export = QPushButton("Export")
        btn_export.clicked.connect(self.on_export)
        btn_export.setStyleSheet("background-color: #28a745; color: white; font-weight: bold;")
        btn_layout.addWidget(btn_export)
        
        self.layout.addLayout(btn_layout)
        
        self.refresh_list()
        
    def refresh_list(self):
        self.list_widget.clear()
        self.notes = []
        
        ids = self.mw.col.find_notes('"note:MindMap Master"')
        for nid in ids:
            note = self.mw.col.get_note(nid)
            title = note['Title']
            # Check if AllowNewCards field exists and get its value
            try:
                allow_new = note['AllowNewCards']
            except KeyError:
                allow_new = '1'  # Default to '1' if field doesn't exist
            
            status_icon = "✓" if allow_new == "1" else "✗"
            display_text = f"{status_icon} {title}"
            
            self.notes.append((title, nid))
            self.list_widget.addItem(display_text)
            
    def get_selected_nid(self):
        row = self.list_widget.currentRow()
        if row < 0:
            return None
        return self.notes[row][1]

    def on_new(self):
        title, ok = getText("Enter a title for the new Mind Map:")
        if not ok or not title.strip():
            return
        
        try:
            uid = str(uuid.uuid4())
            note_id = create_new_mindmap_note(title, uid)
            self.refresh_list()
            # Select the new item
            # self.list_widget.setCurrentRow(self.list_widget.count() - 1)
            # Open it immediately?
            self.open_editor(note_id)
        except Exception as e:
            showInfo(f"Error creating mind map: {e}")

    def on_open(self):
        nid = self.get_selected_nid()
        if nid:
            self.open_editor(nid)
            
    def on_rename(self):
        nid = self.get_selected_nid()
        if not nid:
            return
            
        note = self.mw.col.get_note(nid)
        old_title = note['Title']
        new_title, ok = getText("Rename Mind Map:", default=old_title)
        
        if ok and new_title.strip():
            note['Title'] = new_title
            # Also update the root node topic if possible? 
            # Complex to parse JSON here, maybe just leave it.
            # But user expects root node to change.
            try:
                import json
                data = json.loads(note['Data'])
                if data.get('nodeData') and data['nodeData'].get('id') == 'root':
                    data['nodeData']['topic'] = new_title
                    note['Data'] = json.dumps(data)
            except:
                pass
                
            self.mw.col.update_note(note)
            self.refresh_list()

    def on_delete(self):
        nid = self.get_selected_nid()
        if not nid:
            return
            
        row = self.list_widget.currentRow()
        title = self.notes[row][0]
        
        if askUser(f"Are you sure you want to delete '{title}'? This cannot be undone."):
            self.mw.col.remove_notes([nid])
            self.refresh_list()
    
    def on_toggle_active(self):
        """Toggle whether this mind map allows new card associations"""
        nid = self.get_selected_nid()
        if not nid:
            return
        
        note = self.mw.col.get_note(nid)
        
        # Try to get current value
        try:
            current_value = note['AllowNewCards']
        except KeyError:
            # Field doesn't exist yet - set default and save
            try:
                note['AllowNewCards'] = '1'
                self.mw.col.update_note(note)
                # Reload note to ensure field is synced
                note = self.mw.col.get_note(nid)
                current_value = note['AllowNewCards']
            except KeyError:
                # Still can't access field - something is wrong with model
                from aqt.utils import showInfo
                showInfo("Error: AllowNewCards field not found. Please restart Anki.")
                return
        
        # Toggle: 1 -> 0, 0 -> 1
        new_value = "0" if current_value == "1" else "1"
        
                # Set new value
        try:
            note['AllowNewCards'] = new_value
            self.mw.col.update_note(note)
            
            status = "Active" if new_value == "1" else "Inactive"
            from aqt.utils import tooltip
            tooltip(f"Mind map set to: {status}")
            
            self.refresh_list()
        except KeyError:
            from aqt.utils import showInfo
            showInfo("Error updating field. Please restart Anki.")
            self.refresh_list()

    def on_export(self):
        """Export the selected mind map to JSON + HTML viewer"""
        nid = self.get_selected_nid()
        if not nid:
            showInfo("Please select a mind map to export")
            return
        
        # Use unified export function
        from .export_utils import export_mindmap_to_json
        from aqt.utils import tooltip
        import os
        
        note = self.mw.col.get_note(nid)
        title = note['Title']
        
        success, filename, viewer_path = export_mindmap_to_json(self, self.mw, nid, title)
        
        if success:
            if viewer_path:
                tooltip(f"Exported '{title}' with viewer!\nLocation: {os.path.dirname(filename)}")
            else:
                tooltip(f"Exported '{title}'!\nLocation: {filename}")
        else:
            showInfo("Export cancelled or failed")
    
    def open_editor(self, note_id):
        # Use unified window management method
        MindMapDialog.open_instance(self.mw, note_id)
