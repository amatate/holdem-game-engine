# 扩展素材 v1 · 完整生成提示词

## 四位角色的 v2 留白修正

分别以对应 v1 图集为唯一编辑目标，使用相同修正提示词，保留初稿而不覆盖。

```text
Use case: precise-object-edit.
Input image 1 is the EXACT edit target: an existing original three-frame pixel-art character atlas. Make ONE narrowly-scoped production correction. Keep the same character identity, age, face, hairstyle, clothing, all three expressions, the existing gestures, colors, pixel-art details and the exact left-to-right order. DO NOT invent a new design.
The problem: shoulders and sleeves currently touch or cross each 512-pixel cell boundary.
Output MUST remain 1536x1024 PNG with true transparent alpha, exactly three 512x1024 cells. Within EACH separate cell, uniformly reduce ONLY its existing portrait to approximately 78 percent of its current width AND height, centered on x=256 of that cell, with the bottom of the portrait/hands at y=940. Thus each portrait's maximum width is about 400 px, leaving AT LEAST 50 fully transparent pixels at BOTH vertical edges of EVERY cell. Each complete shoulder, sleeve, hand and all hair must fit wholly within this cell with no clipping; reconstruct only the few missing edge pixels of sleeves if needed. All three portraits share the same head size, head-top height (approximately 280–295px) and bottom baseline. Maintain proportions, don't squash width separately, don't enlarge faces. Preserve the exact expressions and low hand poses. Keep pixel edges crisp, not blurred. No background color, no glow, no halo, no checkerboard painted into pixels, no text, no frames, no labels, no added objects. Do not add a duplicate portrait or change cell count.
This is a sprite-atlas spacing/canvas-layout edit, not a new illustration or character reinterpretation. Each silhouette must be completely isolated by genuine alpha-zero gutters.
```


生成方式：内置 image_gen；使用现有项目图片作风格参考，不使用第三方游戏原图。四位角色的新外形是美术提案，不新增剧情事实或更改 NPC 策略。

人物参考：`src/web/art/hunter-v1.png`、`src/web/art/calling-station-v1.png`。场景参考：`src/web/art/room-v1.png`。

## 老周「岩石」 / rock-v1.png

```text
Use case: stylized-concept.
Asset type: a production-style transparent character expression atlas for the existing original Chinese poker game 夜局.
Input image 1 (林岚 atlas) and image 2 (莫叔 atlas) are STYLE / PIXEL SCALE / LAYOUT REFERENCES ONLY. Create a different named adult person specified below, not either reference character. Do not copy their hairstyles, faces, accessories or outfits.
Output: one 1536x1024 landscape PNG with genuine TRANSPARENT ALPHA. Exactly THREE equal vertical 512x1024 cells. One front-facing waist-up portrait of the SAME new character per cell, at identical size and camera angle, all hair/shoulders/hands fully inside each cell. Head tops at y approximately 115, waist baseline at y approximately 940, empty transparent gutters and margins. Same adult face, haircut, clothing seams and lighting in all three. No full-body legs, no scene, no table, no chairs, no rectangle behind people, no ambient colored haze. No letters, captions, name, logos, watermark, UI or labels. Do not bake a checkerboard or black background.
State sequence LEFT TO RIGHT: NEUTRAL quietly watching, SPEAKING naturally slightly open mouth, PUBLIC WIN a restrained satisfied expression with one modest low hand gesture. Only tiny expressive differences, not three different costumes or camera poses. Hands never cover faces. These are discrete states, NOT turnaround views and NOT an animation strip.
Style: match reference's mature East Asian anime-influenced pixel illustration, deliberate square pixel clusters, crisp stepped contours, restrained dithering, 4–6-shade cloth/skin ramps. Deep plum outlines #1B1730, muted dusty violet shadows #41325B, warm paper highlights #F3E6C7, quiet amber room-light. Opaque subject interiors; transparent outside silhouette. NOT a smooth painting with a pixelation filter, not chibi or teenage, not photoreal or 3D, no exaggerated glow or dramatic hidden-card tells.
Subject: 老周, nickname 岩石, a reserved Chinese man about 48–55. Compact square head, broad sturdy neck, short close-cropped salt-and-pepper hair, straight heavy brows, tired attentive dark eyes, clean-shaven jaw, mature horizontal forehead creases. He looks quiet and dependable, not villainous or like a policeman. Distinct from the soft smiling bespectacled older reference man: NO glasses, NO moustache, NO wavy hair.
Outfit from our design plan: simple dark charcoal work/casual jacket, understated square construction, over slate-blue collared shirt with top button closed but no tie. Matte worn cloth, no logos, weapons, uniform insignia or jewelry. Seated portrait shoulders compact and arms held close, hands loosely folded low near waist as if keeping his space tidy; no chips or cards painted in. Neutral lips closed, speaking a tiny measured opening, win barely perceptible corner smile and a quiet nod without changing head height materially. Same stable silhouette in all cells.
```

## 程墨「小刀」 / small-ball-v1.png

```text
Use case: stylized-concept.
Asset type: a production-style transparent character expression atlas for the existing original Chinese poker game 夜局.
Input image 1 (林岚 atlas) and image 2 (莫叔 atlas) are STYLE / PIXEL SCALE / LAYOUT REFERENCES ONLY. Create a different named adult person specified below, not either reference character. Do not copy their hairstyles, faces, accessories or outfits.
Output: one 1536x1024 landscape PNG with genuine TRANSPARENT ALPHA. Exactly THREE equal vertical 512x1024 cells. One front-facing waist-up portrait of the SAME new character per cell, at identical size and camera angle, all hair/shoulders/hands fully inside each cell. Head tops at y approximately 115, waist baseline at y approximately 940, empty transparent gutters and margins. Same adult face, haircut, clothing seams and lighting in all three. No full-body legs, no scene, no table, no chairs, no rectangle behind people, no ambient colored haze. No letters, captions, name, logos, watermark, UI or labels. Do not bake a checkerboard or black background.
State sequence LEFT TO RIGHT: NEUTRAL quietly watching, SPEAKING naturally slightly open mouth, PUBLIC WIN a restrained satisfied expression with one modest low hand gesture. Only tiny expressive differences, not three different costumes or camera poses. Hands never cover faces. These are discrete states, NOT turnaround views and NOT an animation strip.
Style: match reference's mature East Asian anime-influenced pixel illustration, deliberate square pixel clusters, crisp stepped contours, restrained dithering, 4–6-shade cloth/skin ramps. Deep plum outlines #1B1730, muted dusty violet shadows #41325B, warm paper highlights #F3E6C7, quiet amber room-light. Opaque subject interiors; transparent outside silhouette. NOT a smooth painting with a pixelation filter, not chibi or teenage, not photoreal or 3D, no exaggerated glow or dramatic hidden-card tells.
Subject: 程墨, nickname 小刀, a thoughtful Chinese man about 28–35, slender adult neck and narrow shoulders, long narrow oval face, small straight nose, understated angular brows, neat straight dark hair with a soft side part and one controlled longer front strand. Clean shaven, no glasses, no jewelry. Quietly curious, approachable, not a teenage schoolboy and not sinister. Visibly different from the heavy-set rock character or the energetic red-haired NPC.
Outfit from our design plan: slim muted blue-gray casual overshirt over a warm pale ivory shirt; light cuffs rolled neatly once, modest closed neckline, small practical seams, not a formal suit or school uniform. He makes small measured gestures with long natural fingers LOW at waist. Neutral attentive slightly tilted gaze, speaking a small open-mouth phrase and one restrained low palm-up gesture, win a modest closed-mouth smile with relaxed hands. The nickname is metaphorical: absolutely NO knife, weapon, sharp tool, tattoos or props.
```

## 苏蔓「伏蛇」 / trapper-v1.png

```text
Use case: stylized-concept.
Asset type: a production-style transparent character expression atlas for the existing original Chinese poker game 夜局.
Input image 1 (林岚 atlas) and image 2 (莫叔 atlas) are STYLE / PIXEL SCALE / LAYOUT REFERENCES ONLY. Create a different named adult person specified below, not either reference character. Do not copy their hairstyles, faces, accessories or outfits.
Output: one 1536x1024 landscape PNG with genuine TRANSPARENT ALPHA. Exactly THREE equal vertical 512x1024 cells. One front-facing waist-up portrait of the SAME new character per cell, at identical size and camera angle, all hair/shoulders/hands fully inside each cell. Head tops at y approximately 115, waist baseline at y approximately 940, empty transparent gutters and margins. Same adult face, haircut, clothing seams and lighting in all three. No full-body legs, no scene, no table, no chairs, no rectangle behind people, no ambient colored haze. No letters, captions, name, logos, watermark, UI or labels. Do not bake a checkerboard or black background.
State sequence LEFT TO RIGHT: NEUTRAL quietly watching, SPEAKING naturally slightly open mouth, PUBLIC WIN a restrained satisfied expression with one modest low hand gesture. Only tiny expressive differences, not three different costumes or camera poses. Hands never cover faces. These are discrete states, NOT turnaround views and NOT an animation strip.
Style: match reference's mature East Asian anime-influenced pixel illustration, deliberate square pixel clusters, crisp stepped contours, restrained dithering, 4–6-shade cloth/skin ramps. Deep plum outlines #1B1730, muted dusty violet shadows #41325B, warm paper highlights #F3E6C7, quiet amber room-light. Opaque subject interiors; transparent outside silhouette. NOT a smooth painting with a pixelation filter, not chibi or teenage, not photoreal or 3D, no exaggerated glow or dramatic hidden-card tells.
Subject: 苏蔓, canonical nickname 伏蛇, a patient Chinese woman about 32–40. Soft oval adult face, dark almond-shaped eyes, defined but gentle brows, long dark plum-black hair pulled into a LOW loose bun at the nape with a long side-swept fringe and two fine face-framing strands, no hair clip. This must NOT resemble the reference woman's sharp black bob. Calm thoughtful warm composure, observant rather than seductive; ordinary fully clothed adult proportions.
Outfit from our design plan: muted dusty-plum casual cardigan with restrained gathered sleeves over a warm ivory high round-neck blouse, simple narrow brass button details, no cleavage, no jeweled headdress, no fantasy robe, no animal motifs, no snakes. A small understated single pearl earring on each ear is consistent across all states. Hands resting together low in front; neutral quietly listening with a slight head inclination, speaking softly with a small natural mouth opening, win a knowing but kind closed-mouth half-smile, one hand gently touching the other wrist low near waist. No card-strength expression, no magical eyes.
```

## 韩烈「重锤」 / value-bettor-v1.png

```text
Use case: stylized-concept.
Asset type: a production-style transparent character expression atlas for the existing original Chinese poker game 夜局.
Input image 1 (林岚 atlas) and image 2 (莫叔 atlas) are STYLE / PIXEL SCALE / LAYOUT REFERENCES ONLY. Create a different named adult person specified below, not either reference character. Do not copy their hairstyles, faces, accessories or outfits.
Output: one 1536x1024 landscape PNG with genuine TRANSPARENT ALPHA. Exactly THREE equal vertical 512x1024 cells. One front-facing waist-up portrait of the SAME new character per cell, at identical size and camera angle, all hair/shoulders/hands fully inside each cell. Head tops at y approximately 115, waist baseline at y approximately 940, empty transparent gutters and margins. Same adult face, haircut, clothing seams and lighting in all three. No full-body legs, no scene, no table, no chairs, no rectangle behind people, no ambient colored haze. No letters, captions, name, logos, watermark, UI or labels. Do not bake a checkerboard or black background.
State sequence LEFT TO RIGHT: NEUTRAL quietly watching, SPEAKING naturally slightly open mouth, PUBLIC WIN a restrained satisfied expression with one modest low hand gesture. Only tiny expressive differences, not three different costumes or camera poses. Hands never cover faces. These are discrete states, NOT turnaround views and NOT an animation strip.
Style: match reference's mature East Asian anime-influenced pixel illustration, deliberate square pixel clusters, crisp stepped contours, restrained dithering, 4–6-shade cloth/skin ramps. Deep plum outlines #1B1730, muted dusty violet shadows #41325B, warm paper highlights #F3E6C7, quiet amber room-light. Opaque subject interiors; transparent outside silhouette. NOT a smooth painting with a pixelation filter, not chibi or teenage, not photoreal or 3D, no exaggerated glow or dramatic hidden-card tells.
Subject: 韩烈, nickname 重锤, a serious Chinese man about 35–45, broad athletic shoulders and sturdy thick forearms, adult rectangular face, medium tan skin, short neatly brushed-back dark brown hair, strong straight brows, steady dark eyes, clean shaven. Solid and conscientious rather than aggressive. Clearly distinct from both elderly man and young impulsive red-haired NPC. No scars or caricature muscles.
Outfit from our design plan: muted ochre/russet heavy twill overshirt with rolled forearm cuffs over a dark warm charcoal crew-neck T-shirt, simple practical construction, no leather biker costume, no military symbols, no logos or jewelry. Neutral forearms firmly but gently resting low near waist with natural open hands, speaking a calm short sentence and a small low open-hand emphasis, public win relaxed firm half-smile and slight low fist closure, never raised threateningly. Nickname is metaphorical: NO hammer, weapon, tools or combat pose.
```

## 雨夜牌室入口 / entrance-rain-v1.png

```text
Use case: stylized-concept.
Asset type: original standalone environment background for the lobby/chapter entry of the Chinese browser poker game 夜局, NOT a UI screenshot.
Input image 1 is our existing upstairs card-room background: architectural material, pixel density, warm/cool lighting and palette reference ONLY. Generate a NEW viewpoint of the entrance to that same kind of lived-in upstairs card room.
Output wide approximately 16:9 landscape opaque PNG, preferably 1792x1024 or nearest landscape. Nighttime on the top landing of an old city building, quiet and welcoming, rain-streaked tall window on the left with violet-blue city light beyond. On the right a half-open dark wood door reveals part of a teal felt card table and one empty wooden chair under a low warm amber lamp; no people, no visible playing cards or chip piles. A modest coat/umbrella stand and small potted plant provide lived-in detail near the door. Muted wooden floorboards reflecting a very small amount of cool rain light. Leave the middle-left 40 percent of the image a dark low-contrast uncluttered wall/window-shadow zone suitable for an actual HTML menu overlay. A small empty unlettered brass plaque by the doorway, NO readable words anywhere. No title, no buttons, no UI frames, no legible numbers, no sign slogans, no brand marks, no watermarks.
Style: refined hand-built pixel-art environment matching reference, square clusters and deliberate stair-step silhouettes, limited material shade ramps, selective dithering, NOT photorealistic and NOT a smooth 3D render covered with a pixel filter. Deep plum #1B1730, dusty purple #41325B, table teal #24554F, amber #E7B866, restrained distant rose reflections #F07BA3, paper warm highlights. Mood: people might arrive any minute, intimate nocturnal everyday city life, not a luxurious casino, not a nightclub, not horror. Clear entrance silhouette, beautiful but quiet background, usable space for live UI.
```
