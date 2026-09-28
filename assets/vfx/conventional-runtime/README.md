# Conventional explosion runtime assets

The two RGBA atlases contain eight material phases and two opposing views of a
fire/smoke volume lobe from each of the ten Blender studies. `profiles.json`
retains each study's spatial lobe motion, dimensions and secondary-burst delays.
The runtime scatters these animated cards in 3D and uses the existing particle
pool for moving fragments. Authoring scenes remain editable and unchanged.

Rebuild from the repository root with Blender 4.2 and Python with Pillow. Keep
intermediate tiles outside the repository:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 4.2/blender.exe' --background --python scripts/export_explosion_atlases.py -- --tiles 'F:/Users/gunda/Desktop/Explosion-Atlas-Tiles'
python scripts/export_explosion_atlases.py --pack --tiles 'F:/Users/gunda/Desktop/Explosion-Atlas-Tiles'
```

Packing rejects clipped alpha borders. Runtime textures use sRGB, linear
filtering, transparent tile padding and no mipmaps. Frame interpolation and
per-camera billboard data support opposing split views; depth testing preserves
wall occlusion. Existing geometric effects remain available during preload or
after a texture-load failure. Clear resets all events; dispose releases textures,
meshes, materials and data textures, including late loads.

`ConventionalExplosionProfiles.js` owns the event mapping. Actual floor contact
chooses grenade/rocket; wall contact chooses breaching. A missing contact stays
airborne. Bombs and bomber crashes keep their established arena-floor behavior.
Rocket interception uses an elongated burst along the incoming flight; gun
interception uses a fragmentation flash. Fuel and staggered bursts distinguish
vehicle destruction. A fresh overlapping fatal rocket hit retains smoke and
fragments while its fire shell yields to the vehicle explosion. Item, trail and
reactor effects retain their own presentation.

The host snapshots bounded presentation events with an id, profile, pose,
orientation, scale and age. Clients replay them once, advance their phase and
suppress duplicate disappearance effects. Player deaths retain their existing
snapshot replay and carry the authoritative profile. These fields do not alter
damage, knockback, removal, scoring or weapon logic. Older snapshots retain the
previous disappearance fallback.

The fixed pool holds 24 events, 96 fire cards, 192 smoke cards and 1000 shared
3D particles. Per-profile fragments are capped at 34, then reduced to eight at
long range, or four when the shared particle pool is busy. Distant smoke and low
graphics quality use fewer cards. New events take priority when the pool fills.
The selected card counts came from an isolated 8/24-event, single/four-view
comparison of the previous geometric presentation, 96/192 and 192/384. At 24
events and four views, the 95th-percentile draw time was 2.7 ms for 96/192 and
4.3 ms for 192/384 on the test machine. The focused desktop spec compares the
selected runtime budget against the previous presentation with synchronous GPU
completion; these timings describe that scene and hardware, not gameplay FPS.
