# Wall Spinner Designer

An interactive playground for designing counter-rotating kinetic wall spinners. Two identical discs are mounted on one axle, with the back disc flipped. You draw one arm, and the app repeats it around the hub, animates both discs, and exports cut files.

The app is plain HTML, CSS and JavaScript. It has no build step and no dependencies.

## Run it

Serve the `designer/` folder with any static web server:

```powershell
python -m http.server 5173 --directory designer
```

Then open http://localhost:5173. Or use the live version at https://wisejohn.github.io/wall-spinner-designer/. Opening `designer/index.html` directly from disk also works.

## What it does

- **Arm editor**: you draw the master arm at 12 o'clock and the other arms follow live.
  - **Pen** (`P`): click to place corners, or drag to place curve points. Click the first point to close the shape into a filled outline. Press Enter or double-click to finish an open stroke.
  - **Brush** (`B`): drag to draw freehand. The result is a variable-width stroke with editable nodes. Pen pressure is used if your device has it.
  - **Outline** (`L`): drag to draw a freehand closed shape.
  - **Select** (`V`): drag nodes, Bézier handles and width diamonds. Double-click a curve to add a node. Double-click a node to cycle it through smooth, corner and sharp.
  - **Mirror** (`M`): makes a part symmetric about the arm's axis.
  - **Presets**: hooked blade, swirl, two-segment arm, tapered spoke, petal loop, sweep blade and mirrored leaf.
- **Disc settings**: number of arms, diameter, hub, axle hole, optional outer rim, trim to diameter, material thickness and a mounting bolt circle.
- **Dual-disc view**: shows the flipped back disc behind the front one at any offset angle. It can appear in the editor, in the side preview, or in a large preview (`Tab`).
- **Animation** (`Space` to play or pause):
  - Constant counter-rotation.
  - **Yo-yo**: ramps up, holds at speed, ramps down, pauses, then reverses.
  - Pendulum (sine).
  
  A speed-profile graph shows where you are in the cycle.
- **Connectivity check**: the status bar warns when arms don't connect to the hub, because those pieces would fall out when cut.
- **Save and open**: saves designs as `.spinner.json` files. Open them again, or drag one onto the window. The app also autosaves in the browser and has undo and redo.

## Export

| Format | Use |
| --- | --- |
| SVG | Laser cutting. One merged hairline cut path in mm, with an option for 2 copies side by side. A filled variant is available for vinyl or CNC preview. |
| DXF (R12) | Laser cutting or CAD. Closed polylines on a `CUT` layer, in mm. |
| STL | 3D printing. A watertight solid extruded to the material thickness. |
| OpenSCAD | Editable 3D source (`linear_extrude` of the outline). |
| Print / PDF | A paper cutting template at true scale. Large discs are tiled across Letter, Legal, Tabloid, A4 or A3 pages, with overlap bands, registration marks and a 50 mm scale check. |
| PNG | Image of the preview. |

### How the cut outline is made

The app merges the hub, every arm, the rim, and the holes into one outline. To do this, it paints the disc at about 0.08 mm per pixel. It then traces the edge with sub-pixel marching squares and simplifies the result to within about 0.03 mm.

So the exported file always matches what you see on screen, with no polygon-boolean library. Kerf compensation isn't applied yet, so set that in your laser software.

## Layout

```
designer/
  index.html
  css/app.css
  js/geometry.js   vectors, Béziers, stroke→outline, simplification
  js/earcut.js     polygon triangulation for STL
  js/state.js      design model, presets, undo/redo, autosave
  js/render.js     disc painting + cut-outline tracing
  js/editor.js     editor canvas and drawing tools
  js/preview.js    counter-rotation animation
  js/export.js     SVG / DXF / STL / SCAD / PNG / print template
  js/ui.js         panels, shortcuts, boot
testapps/          earlier experiments
inspiration/       reference images (kept local, not in the repo)
```
