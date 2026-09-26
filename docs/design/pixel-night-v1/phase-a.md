# 阶段 A：像素实战牌桌

用户已确认角色三视图并要求实施第 1 阶段。本次范围：真实牌桌、卡牌与行动区、三位核心角色；不重写规则，不实施完整新主页或人物笔记产品改版。

实施结果：四张生成图片已接入 `src/web/art/`，不是仅交付预览。资产规格与透明度说明见该目录 README；真实对局、移动端、能力/教学检查及截图见 `docs/playtests/pixel-table-phase-a.md`。新预览使用 4181，旧存档未经迁移。

## 实施前设计复核

沿用已确认六色：深梅夜 #1B1730、旧屏紫 #41325B、桌毡青 #24554F、票纸白 #F3E6C7、霓虹莓 #F07BA3、筹码金 #E7B866。中文标题使用系统黑体的紧凑粗字与像素硬阴影，正文 PingFang SC，数字系统 monospace；本阶段不引入未经许可确认的字体。

布局：三位核心对手的半身像围住上半桌，牌与筹码集中在中下部，我方手牌和合法行动保持一屏可用；六人及手机采用紧凑席位。

```text
模式 / 手数 / 速度
    NPC       NPC       NPC
          底池 / 公共牌
         我的牌与筹码
弃牌 / 跟注或过牌 / 加注到 / 全下
保存状态与原有辅助面板
```

自检修正：不直接铺概念截图；所有卡牌和金额保持 DOM。背景不含人物、牌和文字，避免重复和假信息。角色表情只响应当前公开发言、动作、发奖事件；经典模式无能力组件。新主题单独样式文件接入，保留原有教学/存档/观察行为。

## 美术生成

内置 image_gen；角色三帧图集请求真实透明背景（常态/说话/公开获胜），环境单独生成。以用户已确认的三视图和场景概念为参考。实际输出、透明度和浏览器显示须检查后记录；未通过时不得声称已是合格透明资产。

### hunter

```text
Use case: identity-preserve. Create a production 2D pixel-art character expression atlas for the browser poker game 夜局. Input image 1 is the approved character sheet, identity and clothing reference ONLY. Keep the same adult face, hair, accessories, clothing and handmade pixel aesthetic.
Output: one landscape PNG with TRUE TRANSPARENT ALPHA background, not a painted checkerboard, not white, no gradient, no floor/shadow rectangle, no text, no labels. Target aspect ratio 3:2, preferably 1536x1024 pixels. Divide the canvas into exactly THREE identical vertical cells of width one-third of the canvas. In each cell render the SAME character, front-facing WAIST-UP, isolated full silhouette with both shoulders and forearms visible, no table or chair. Same head size, same waist baseline, same lighting and camera angle in all three cells. Head tops at about 10% canvas height, waist cut at 96%, figure confined within the middle 88% of each cell's width, enough transparent gutter to prevent overlap. These are three aligned state portraits, NOT front/side/back views.
Left cell NEUTRAL: relaxed neutral face, forearms gently resting forward near waist.
Middle cell SPEAKING: same body and clothing, a small natural mouth-open change, slight forward inclination.
Right cell PUBLIC WIN: same body and clothes, small satisfied smile and subtle hand gesture near waist, no props.
Use crisp dark pixel contours, solid opaque interiors, selective pixel dithering, restrained 4-6-shade material ramps. No smooth photoreal skin, no chibi, no full body legs. Do not reproduce any sheet headings, palettes, guide lines or expressions outside the three cells. All three portraits must be aligned for direct CSS sprite switching. Genuine transparent negative space around the three people.
Character: adult Chinese woman 林岚, short ink black bob, small teal hair clip on HER RIGHT side (viewer left in front), subtle slim silver earring, deep petrol teal jacket over cream collared shirt. Calm sharp dark eyes. Stay modest and completely clothed. Match her front-view reference facial identity. Neutral not smiling broadly; speaking restrained; public-win a very subtle closed-mouth half-smile.
```

### maniac

```text
Use case: identity-preserve. Create a production 2D pixel-art character expression atlas for the browser poker game 夜局. Input image 1 is the approved character sheet, identity and clothing reference ONLY. Keep the same adult face, hair, accessories, clothing and handmade pixel aesthetic.
Output: one landscape PNG with TRUE TRANSPARENT ALPHA background, not a painted checkerboard, not white, no gradient, no floor/shadow rectangle, no text, no labels. Target aspect ratio 3:2, preferably 1536x1024 pixels. Divide the canvas into exactly THREE identical vertical cells of width one-third of the canvas. In each cell render the SAME character, front-facing WAIST-UP, isolated full silhouette with both shoulders and forearms visible, no table or chair. Same head size, same waist baseline, same lighting and camera angle in all three cells. Head tops at about 10% canvas height, waist cut at 96%, figure confined within the middle 88% of each cell's width, enough transparent gutter to prevent overlap. These are three aligned state portraits, NOT front/side/back views.
Left cell NEUTRAL: relaxed neutral face, forearms gently resting forward near waist.
Middle cell SPEAKING: same body and clothing, a small natural mouth-open change, slight forward inclination.
Right cell PUBLIC WIN: same body and clothes, small satisfied smile and subtle hand gesture near waist, no props.
Use crisp dark pixel contours, solid opaque interiors, selective pixel dithering, restrained 4-6-shade material ramps. No smooth photoreal skin, no chibi, no full body legs. Do not reproduce any sheet headings, palettes, guide lines or expressions outside the three cells. All three portraits must be aligned for direct CSS sprite switching. Genuine transparent negative space around the three people.
Character: adult Chinese man 阿凯, tousled dark auburn hair, brick-red bomber jacket, black shirt, small thin silver necklace, energetic confident face. Match reference. Neutral lopsided smirk; speaking a playful open-mouth challenge; public-win a grin and a small raised closed fist near waist, not up across face. No lettering on jacket.
```

### calling-station

```text
Use case: identity-preserve. Create a production 2D pixel-art character expression atlas for the browser poker game 夜局. Input image 1 is the approved character sheet, identity and clothing reference ONLY. Keep the same adult face, hair, accessories, clothing and handmade pixel aesthetic.
Output: one landscape PNG with TRUE TRANSPARENT ALPHA background, not a painted checkerboard, not white, no gradient, no floor/shadow rectangle, no text, no labels. Target aspect ratio 3:2, preferably 1536x1024 pixels. Divide the canvas into exactly THREE identical vertical cells of width one-third of the canvas. In each cell render the SAME character, front-facing WAIST-UP, isolated full silhouette with both shoulders and forearms visible, no table or chair. Same head size, same waist baseline, same lighting and camera angle in all three cells. Head tops at about 10% canvas height, waist cut at 96%, figure confined within the middle 88% of each cell's width, enough transparent gutter to prevent overlap. These are three aligned state portraits, NOT front/side/back views.
Left cell NEUTRAL: relaxed neutral face, forearms gently resting forward near waist.
Middle cell SPEAKING: same body and clothing, a small natural mouth-open change, slight forward inclination.
Right cell PUBLIC WIN: same body and clothes, small satisfied smile and subtle hand gesture near waist, no props.
Use crisp dark pixel contours, solid opaque interiors, selective pixel dithering, restrained 4-6-shade material ramps. No smooth photoreal skin, no chibi, no full body legs. Do not reproduce any sheet headings, palettes, guide lines or expressions outside the three cells. All three portraits must be aligned for direct CSS sprite switching. Genuine transparent negative space around the three people.
Character: Chinese man 莫叔 around 55-60, soft stocky build, salt-and-pepper side-part hair, round wire spectacles, small grey moustache, olive/moss cardigan over warm grey collared shirt. No tie. Match reference face and age. Neutral kind reassuring look; speaking patiently; public-win gentle pleased smile. Both hands stay low and naturally visible, no tea cup in this atlas.
```

### room

```text
Use case: stylized-concept. Produce a pixel-art ENVIRONMENT BACKGROUND LAYER for our existing Chinese poker browser game 夜局. Input image is the previous game UI concept, visual palette and architecture reference only. New original output: a quiet late-night upstairs card room, wide 16:9 panoramic composition. Crisp hand-drawn pixel-art, confident square clusters and limited color ramps matching reference, not smooth photograph with pixelation. Deep plum shadows #1B1730, dusty purple #41325B, muted teal ambient light, warm amber pendant light and restrained pink city reflections. A rainy window at rear-left, old shelves at rear-right, one hanging warm lamp centered near the top, a wall clock and a few unlettered room objects. Building lights outside have NO text or signage letters. Keep upper central backdrop uncluttered behind characters, and lower two-thirds very dark quiet room material with plenty of negative space to be covered by a live CSS poker table. Crucially NO people, NO characters, NO table surface, NO playing cards, NO chips, NO visible chair backs in the central region, NO UI, NO labels, NO inspirational slogans, NO Chinese or English writing anywhere. No logos or watermarks. This is an opaque environment background, not a screenshot, not the final whole interface. Static lighting.
```
