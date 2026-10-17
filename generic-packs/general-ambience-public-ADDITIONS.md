# 通用素材许可与新增录音署名

保留各原包的 CREDITS 和许可文件；不暗示作者背书。新增录音保留完整长度，没有裁短、拼接或拉伸。环境音按整段循环，并非无缝循环承诺。

## 公园风声 / park_ambience_wind.wav

- Author: Thimras
- Source: https://opengameart.org/content/park-ambiences
- Original download: https://opengameart.org/sites/default/files/park_ambience_wind.wav
- License: CC0-1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
- Source format: Complete original WAV
- Processing: Full recording; no trim, repeat, crossfade or pitch change. ffmpeg -map_metadata -1 -af loudnorm=I=-18:TP=-3:LRA=11:measured_I=-42.99:measured_TP=-11.78:measured_LRA=11.90:measured_thresh=-52.99:offset=2.83:linear=true -ar 44100 -c:a libvorbis -q:a 5
- Decoded: -19.01 LUFS / -2.15 dBTP; 256803 ms

## 教室课间交谈 / Ambient classroom mono.ogg

- Author: rcrossley
- Source: https://commons.wikimedia.org/wiki/File:Ambient_classroom_mono.ogg
- Original download: https://upload.wikimedia.org/wikipedia/commons/1/10/Ambient_classroom_mono.ogg
- License: Public domain (PD-author) (https://commons.wikimedia.org/wiki/File:Ambient_classroom_mono.ogg)
- Source format: Complete recording distributed by Wikimedia Commons
- Processing: Full recording; no trim, repeat or pitch change. Static gain and latency-compensated look-ahead limiter for rare high peaks. ffmpeg -map_metadata -1 -af volume=8.010000dB,aresample=192000,alimiter=limit=0.707946:attack=5:release=50:level=false:latency=true -ar 44100 -c:a libvorbis -q:a 5
- Decoded: -18.26 LUFS / -2.42 dBTP; 65463 ms

## 咖啡馆交谈与奶泡机 / Cafe ambiance.ogg

- Author: Marble Toast
- Source: https://commons.wikimedia.org/wiki/File:Cafe_ambiance.ogg
- Original download: https://upload.wikimedia.org/wikipedia/commons/5/54/Cafe_ambiance.ogg
- License: CC0-1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
- Source format: Complete recording distributed by Wikimedia Commons
- Processing: Full recording; no trim, repeat, crossfade or pitch change. ffmpeg -map_metadata -1 -af loudnorm=I=-18:TP=-3:LRA=11:measured_I=-16.65:measured_TP=0.07:measured_LRA=2.50:measured_thresh=-26.65:offset=-0.28:linear=true -ar 44100 -c:a libvorbis -q:a 5
- Decoded: -17.99 LUFS / -2.38 dBTP; 1200001 ms

## 夏日森林底声 / Forest ambience (Gravity Sound).wav

- Author: Gravity Sound
- Source: https://commons.wikimedia.org/wiki/File:Forest_ambience_(Gravity_Sound).wav
- Original download: https://upload.wikimedia.org/wikipedia/commons/b/be/Forest_ambience_%28Gravity_Sound%29.wav
- License: CC-BY-4.0 (https://creativecommons.org/licenses/by/4.0/)
- Source format: Complete recording distributed by Wikimedia Commons
- Processing: Full recording; no trim, repeat, crossfade or pitch change. ffmpeg -map_metadata -1 -af loudnorm=I=-18:TP=-3:LRA=11:measured_I=-31.48:measured_TP=-22.34:measured_LRA=0.40:measured_thresh=-41.48:offset=-0.07:linear=true -ar 44100 -c:a libvorbis -q:a 5
- Decoded: -18.25 LUFS / -9.58 dBTP; 33000 ms

## 海边浪声 / Ocean Waves on a Tropical Beach.ogg

- Author: J.D. Savanyu (uploaded by Jarrod stanley)
- Source: https://commons.wikimedia.org/wiki/File:Ocean_Waves_on_a_Tropical_Beach.ogg
- Original download: https://upload.wikimedia.org/wikipedia/commons/6/64/Ocean_Waves_on_a_Tropical_Beach.ogg
- License: CC0-1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
- Source format: Complete recording distributed by Wikimedia Commons
- Processing: Full recording; no trim, repeat, crossfade or pitch change. ffmpeg -map_metadata -1 -af loudnorm=I=-18:TP=-3:LRA=11:measured_I=-11.19:measured_TP=0.16:measured_LRA=3.20:measured_thresh=-21.19:offset=0.05:linear=true -ar 44100 -c:a libvorbis -q:a 5
- Decoded: -18.1 LUFS / -6.3 dBTP; 384268 ms

## 商场稀疏人群 / Shopping mall less crowded.ogg

- Author: natalie
- Source: https://commons.wikimedia.org/wiki/File:Shopping_mall_less_crowded.ogg
- Original download: https://upload.wikimedia.org/wikipedia/commons/d/d5/Shopping_mall_less_crowded.ogg
- License: Public domain (PD-author) (https://commons.wikimedia.org/wiki/File:Shopping_mall_less_crowded.ogg)
- Source format: Complete recording distributed by Wikimedia Commons
- Processing: Full recording; no trim, repeat, crossfade or pitch change. ffmpeg -map_metadata -1 -af loudnorm=I=-18:TP=-3:LRA=11:measured_I=-31.71:measured_TP=-0.32:measured_LRA=6.10:measured_thresh=-41.71:offset=1.34:linear=true -ar 44100 -c:a libvorbis -q:a 5
- Decoded: -18.35 LUFS / -2.64 dBTP; 30119 ms

## 室内冰柜底噪 / TheShopCollection_convenience_store_drinks_fridge_drone_2.wav

- Author: LEGIT Audio
- Source: https://opengameart.org/content/the-shop
- Original download: https://opengameart.org/sites/default/files/legit_audio_-_the_shop_free_sfx_wav.zip / TheShopCollection_convenience_store_drinks_fridge_drone_2.wav
- License: CC0-1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
- Source format: Complete original WAV from CC0 free collection
- Processing: Full recording; no trim, repeat, crossfade or pitch change. ffmpeg -vn -sn -dn -map_metadata -1 -af loudnorm=I=-18:TP=-3:LRA=11:measured_I=-15.76:measured_TP=-0.00:measured_LRA=0.80:measured_thresh=-25.76:offset=-0.02:linear=true -ar 44100 -c:a libvorbis -q:a 5
- Decoded: -18.08 LUFS / -2.91 dBTP; 13542 ms

Public-domain classroom and shopping-mall recordings were released by rcrossley and natalie through PDSounds; Wikimedia Commons preserves the author dedication. They are not relabelled CC0.
