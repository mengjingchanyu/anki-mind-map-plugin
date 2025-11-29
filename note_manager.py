import json
from aqt import mw
from anki.models import NotetypeDict

MODEL_NAME = "MindMap Master"

def get_or_create_mindmap_model() -> NotetypeDict:
    """
    Retrieves the MindMap Master note type, creating it if it doesn't exist.
    """
    col = mw.col
    model = col.models.by_name(MODEL_NAME)
    
    if model:
        # Check if AllowNewCards field exists, add it if missing (migration)
        field_names = [f['name'] for f in model['flds']]
        if 'AllowNewCards' not in field_names:
            col.models.add_field(model, col.models.new_field("AllowNewCards"))
            col.models.save(model)
            print("Added AllowNewCards field to existing MindMap Master model")
        return model
    
    # Create new model
    model = col.models.new(MODEL_NAME)
    
    # Add fields
    # Title: The name of the mind map
    col.models.add_field(model, col.models.new_field("Title"))
    
    # Data: The JSON data of the mind map (hidden in editor usually, but we keep it plain)
    col.models.add_field(model, col.models.new_field("Data"))
    
    # DisplayHTML: The static representation for mobile/review
    col.models.add_field(model, col.models.new_field("DisplayHTML"))
    
    # UUID: Unique ID for linking
    col.models.add_field(model, col.models.new_field("UUID"))
    
    # AllowNewCards: Whether new cards can be linked to this mind map (1=yes, 0=no)
    col.models.add_field(model, col.models.new_field("AllowNewCards"))
    
    # Set the template
    # We want a simple template that just shows the DisplayHTML
    t = col.models.new_template("Card 1")
    t['qfmt'] = "{{Title}}<br>{{DisplayHTML}}"
    t['afmt'] = "{{FrontSide}}"
    col.models.add_template(model, t)
    
    # Add to collection
    col.models.add(model)
    return model

def create_new_mindmap_note(title: str, uuid_str: str) -> int:
    """
    Creates a new MindMap note and returns its ID.
    """
    col = mw.col
    model = get_or_create_mindmap_model()
    note = col.new_note(model)
    note['Title'] = title
    note['UUID'] = uuid_str
    note['AllowNewCards'] = "1"  # Default: allow new cards to link to this mind map
    
    # Initialize with a basic root node (jsMind format)
    initial_data = {
        "meta": {
            "name": title,
            "author": "anki",
            "version": "0.2"
        },
        "format": "node_tree",
        "data": {
            "id": "root",
            "topic": title
        }
    }
    note['Data'] = json.dumps(initial_data)
    note['DisplayHTML'] = f"<h1>{title}</h1><p>(Open MindMap Editor to view)</p>"
    
    col.add_note(note, 0)
    return note.id
