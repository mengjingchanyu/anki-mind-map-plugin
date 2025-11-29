# Background Images

Place your custom background images in this folder to use them in the mind map editor.

## How to Use

1. **Add images**: Copy your image files (.jpg, .jpeg, .png) to this folder
2. **Configure**: Open Anki → Tools → Add-ons → Mind Map - Visual Learning → Config
3. **Set background**: Change the `background_image` field to your image filename
   - Example: `"background_image": "my_wallpaper.jpg"`
4. **Apply**: Restart the mind map editor to see the new background

## Important Notes

- Images in this folder will NOT be synced with AnkiWeb
- Supported formats: JPG, JPEG, PNG
- Recommended: Use images with subtle patterns or light colors for better readability
- Leave `background_image` empty (`""`) to use the default beige color

## Examples

```json
{
    "background_image": ""  // Default beige background
}
```

```json
{
    "background_image": "mountains.jpg"  // Custom background
}
```
