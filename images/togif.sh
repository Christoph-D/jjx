#!/bin/sh

start=0

ffmpeg -ss "$start" -i "$1" -vf "fps=5,palettegen" -y palette.png
ffmpeg -ss "$start" -i "$1" -i palette.png -filter_complex "[0]fps=5,scale=trunc(iw/2)*2:trunc(ih/2)*2[scaled];[scaled][1]paletteuse=dither=none" -loop 0 -y "$2"
rm palette.png
