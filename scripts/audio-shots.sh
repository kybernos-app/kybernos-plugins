#!/bin/bash
# The shots of the audio lot (docs/dev/templates-lots/audio-1.json), made from the voices and pictures in <dir> (default ~/kybernos-archive/templates-catalogue/audio-1; never in git):
# bash scripts/audio-shots.sh [dir]   ->   <dir>/shots/*.mp4, which `scripts/video-compose.mjs` cuts with the voices (see docs/dev/templates-catalogue.md, « The audio lot »).
# Shots of the four audio examples, outside git. Ken Burns clips from the pictures, waveform covers from the voice itself.
set -e
A=${1:-$HOME/kybernos-archive/templates-catalogue/audio-1}
F=${FFMPEG:-ffmpeg}
P=$A/parts
kb() {
  [ -s "$2" ] && return 0   # kb <picture> <out> <seconds> <zoom-in|zoom-out> <pan: l|r|c>
  local d=$(python3 -c "print(int($3*24))")
  local z; local x
  if [ "$4" = "zoom-in" ]; then z="min(1.0+0.12*on/$d,1.12)"; else z="max(1.12-0.12*on/$d,1.0)"; fi
  case $5 in l) x="(iw-iw/zoom)*(1-on/$d)";; r) x="(iw-iw/zoom)*on/$d";; *) x="iw/2-(iw/zoom/2)";; esac
  $F -hide_banner -loglevel error -y -loop 1 -framerate 24 -i "$1" -vf "scale=2560:1600,zoompan=z='$z':x='$x':y='ih/2-(ih/zoom/2)':d=$d:s=1280x800:fps=24,format=yuv420p" -t $3 -c:v libx264 -crf 18 -preset medium "$2"
}
cover() {  # cover <voice> <out> <seconds> <c0> <c1> <wave colour> <lead seconds>   a waveform that scrolls past a fixed play head
  [ -s "$2" ] && return 0
  local lead=$(python3 -c "print(int($7*1000))")
  local pad=1.829   # 640 px of silence at 350 px/s on each side, so the play head (x=640) sits on the voice at the right second
  local w=$(python3 -c "print(int(($3+2*$pad)*350))")
  local png=$A/shots/$(basename $2 .mp4)-wave.png
  $F -hide_banner -loglevel error -y -i "$1" -filter_complex "[0:a]adelay=${lead}|${lead},apad=whole_dur=$3,adelay=1829|1829,apad=pad_dur=$pad,showwavespic=s=${w}x300:colors=$6:scale=sqrt:draw=full[o]" -map "[o]" -frames:v 1 "$png"
  $F -hide_banner -loglevel error -y -f lavfi -i "gradients=s=1280x800:c0=$4:c1=$5:x0=0:y0=0:x1=0:y1=700:speed=0:rate=24:d=$3" -loop 1 -framerate 24 -i "$png" -filter_complex \
   "[1:v]format=rgba,crop=1280:300:'t*350':0,drawbox=x=640:y=0:w=640:h=300:color=black@0.45:t=fill,drawbox=x=638:y=0:w=4:h=300:color=white@0.9:t=fill[w];[0:v]format=rgba[bg];[bg][w]overlay=0:250,format=yuv420p[o]" \
   -map "[o]" -t $3 -c:v libx264 -crf 18 -preset medium "$2"
}
mkdir -p $A/shots
kb $A/frames/audio-relativity-1.jpg $A/shots/relativity-1.mp4 5.6 zoom-in l
kb $A/frames/audio-relativity-2.jpg $A/shots/relativity-2.mp4 7.2 zoom-in c
kb $A/frames/audio-relativity-3.jpg $A/shots/relativity-3.mp4 7.2 zoom-out r
kb $A/frames/audio-bedtime-1.jpg $A/shots/bedtime-1.mp4 7.4 zoom-in c
kb $A/frames/audio-bedtime-2.jpg $A/shots/bedtime-2.mp4 7.8 zoom-in l
kb $A/frames/audio-bedtime-3.jpg $A/shots/bedtime-3.mp4 7.8 zoom-out r
cover $P/voice-voicemail-fr.mp3 $A/shots/cover-voicemail.mp4 16.4 0x0b1626 0x1f4a7a 0xa9d1ff 0.8
cover $P/voice-ocean-en.mp3 $A/shots/cover-ocean.mp4 20.2 0x041a24 0x14707f 0xbfeef2 0.8
ls -la $A/shots
