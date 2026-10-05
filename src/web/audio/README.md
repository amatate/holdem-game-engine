# 游戏音频 / Game audio

## 背景音乐 / BGM

当前曲目为 [Cool Vibes](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100863)，Kevin MacLeod (incompetech.com)，采用 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 署名许可，**不是 CC0**。原 MP3 未改编，约 3:38 / 8.7 MB；本地提供，默认关闭、独立音量，音乐菜单保留作者和许可链接。完整来源、哈希及旧曲归档说明见 [MUSIC-CREDITS.txt](MUSIC-CREDITS.txt)。构建只复制当前 MP3 及信用文件，不复制旧试听曲。

## 短音效 / SFX

11 个 CC0 短音效，来自 [Kenney Casino Audio 1.1](https://kenney.nl/assets/casino-audio) 和 [Interface Sounds 1.0](https://kenney.nl/assets/interface-sounds)，已核对官网及原包许可证。无需署名，但保留作者信用、原始许可和来源；不使用 Kenney 标志，不改变本项目源码／美术的许可状态。

| 事件 | 本地文件 | 原始素材 |
| --- | --- | --- |
| 发底牌（每次轮换） | deal-1-v1.wav / deal-2-v1.wav | card-slide-1.ogg / card-slide-2.ogg |
| 翻公共牌／公开亮牌 | reveal-v1.wav | card-place-1.ogg |
| 弃牌 | fold-v1.wav | card-shove-1.ogg |
| 盲注／跟注／下注／加注 | chips-v1.wav | chip-lay-1.ogg |
| 全下投入 | all-in-v1.wav | chips-handle-1.ogg |
| 派奖／未跟注筹码退回 | payout-v1.wav | chips-stack-1.ogg |
| 过牌 | check-v1.wav | click_001.ogg |
| 新的玩家决策／试听 | turn-v1.wav | question_002.ogg |
| 玩家本手净赢／最终夺冠 | win-v1.wav | confirmation_001.ogg |
| 已成功使用能力的私有反馈 | ability-v1.wav | maximize_001.ogg |

发牌每个事件播放一次，不逐张叠加；人物反应附加帧不重复发声。获胜提示在结算画面展示后播放，不提前泄露结果，拿回筹码但本手净输不播放获胜提示。语音、环境循环和背景音乐不在本批范围。

## 来源与处理

原包地址：

- https://kenney.nl/media/pages/assets/casino-audio/2472606a04-1721639069/kenney_casino-audio.zip
- https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip

原包 SHA-256：

- Casino: `f36250766ac5bc378c13708ddf12a23a8e54a3251f8d482c7536e51b5dbafa18`
- Interface: `f2193d072726d6758a5f7871b2dcc54dcce0d5c35c6f0a62f92549b327c81232`

保留 11 段选中的声音，原始 OGG 转单声道 44.1 kHz / 16-bit PCM WAV，便于浏览器解码兼容；降低峰值，首尾短淡化，不改旋律或合成其他来源。合计 414,352 bytes，约 405 KiB，每段 0.097–0.766 秒。实际峰值 -7.4 至 -6.0 dBFS；运行时还分层衰减，主音量默认 40%。完整文件哈希、时长及处理量见 [manifest.json](manifest.json)。

需要重新处理时，下载并解压上述原包（无需运行包中任何内容），安装 ffmpeg/ffprobe，然后在项目根目录执行：

```bash
node scripts/import-sounds.mjs /path/to/casino-pack /path/to/interface-pack
```

游戏运行不依赖 ffmpeg，不调用第三方音频 CDN，不下载完整原包。构建仅复制 WAV、[CREDITS.txt](CREDITS.txt)、原包许可证和 manifest；预览／Node 服务以固定路径提供这些文件。
