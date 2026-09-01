# Rank badge images

Drop PNGs (or SVGs, update the extension in `src/data/rankSystem.ts` `rankImagePath` if you use SVG) into `legacy/` and `modern/` using this naming convention. Until a file exists, the UI shows a generated color badge instead, nothing breaks, so add these whenever you have them.

## legacy/ (saves before Sept 2020, flat Grand Champion cap, no SSL)
```
unranked.png
bronze-1.png    bronze-2.png    bronze-3.png
silver-1.png    silver-2.png    silver-3.png
gold-1.png      gold-2.png      gold-3.png
platinum-1.png  platinum-2.png  platinum-3.png
diamond-1.png   diamond-2.png   diamond-3.png
champion-1.png  champion-2.png  champion-3.png
grand-champion.png   (single image, no division split in this era)
```

## modern/ (saves Sept 2020+, Grand Champion I/II/III, adds Supersonic Legend)
```
unranked.png
bronze-1.png ... champion-3.png   (same as legacy)
grand-champion-1.png  grand-champion-2.png  grand-champion-3.png
supersonic-legend.png
```
