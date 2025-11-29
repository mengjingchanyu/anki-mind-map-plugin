"""Open mind map from review interface"""
from aqt import mw
from .mindmap_editor import MindMapDialog

def open_mindmap(mindmap_id, node_id=None):
    """Open mind map by ID, optionally focus on specific node"""
    try:
        # Use unified window management method
        MindMapDialog.open_instance(mw, mindmap_id, node_id)
    except Exception as e:
        from aqt.utils import showInfo
        showInfo(f"Unable to open mind map: {e}")

