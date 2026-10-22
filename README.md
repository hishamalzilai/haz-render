# HAZ Render — قالب المنشورات + Render API

يركّب صورة أو فيديو المنشور داخل كارت قالب HAZ، ويضبط العنوان العربي تلقائياً، ويرجع PNG أو MP4 جاهزاً للنشر.

## البنية

```
public/template.png         القالب الأصلي 1080×1350
public/template-frame.png   نفس القالب بكارت شفاف (طبقة علوية)
src/layout.ts               الإحداثيات المقاسة (الكارت، منطقة العنوان، الألوان)
src/fitHeadline.ts          اختيار أكبر حجم خط يحقق ≤ 3 أسطر داخل المنطقة
src/Post.tsx                القالب: media + frame + badge + headline
src/Root.tsx                Still "Post" و Composition "PostVideo"
server/render-server.ts     POST /render لـ n8n
```

## الضبط التلقائي

- **العنوان**: من 78px نزولاً إلى 44px حتى يدخل في 3 أسطر كحد أقصى، مع `text-wrap: balance`.
- **الوسائط**: `cover` إذا كانت نسبة الأبعاد قريبة من الكارت (فرق ≤ 12%)، وإلا `contain` مع خلفية مموهة من نفس الصورة.
- **نقطة التركيز**: `focalX` و`focalY` بالنسبة المئوية (من Gemini) تتحكم في القص.
- **الفيديو**: `startSec` يبدأ من أقوى لحظة، و`durationSec` لطول المقطع، و`voiceover` يستبدل الصوت الأصلي بصوتك.

## التشغيل محلياً

```bash
npm install
npx remotion versions        # تأكد أن كل حزم @remotion بنفس الإصدار
npm run studio               # معاينة القالب في المتصفح وتعديل الـ props
npm run still                # رندر تجريبي إلى out/test.png
```

## النشر على Coolify

1. أنشئ Application من الـ repo باستخدام **Dockerfile**.
2. أضف المتغيرات من `.env.example`، خاصة `RENDER_TOKEN` و`PUBLIC_BASE_URL`.
3. Volume دائم على `/app/data`.
4. الموارد: 2 vCPU و2–4GB RAM على الأقل.

## الاستدعاء من n8n (HTTP Request node)

```http
POST https://render.your-domain.com/render
Authorization: Bearer <RENDER_TOKEN>
Content-Type: application/json

{
  "type": "still",
  "media": "https://example.com/frame.png",
  "headline": "أداة مفتوحة المصدر تحذف الموسيقى من أي فيديو تلقائياً",
  "badge": "مفتوح المصدر",
  "focalX": 50,
  "focalY": 40
}
```

للفيديو: `"type": "video"` مع `startSec` و`durationSec` واختيارياً `voiceover`.

الرد:

```json
{ "id": "…", "url": "https://render.your-domain.com/out/<id>.png", "mediaWidth": 1600, "mediaHeight": 1000 }
```

## الأمان

- Bearer token بمقارنة timing-safe.
- **SSRF guard**: يرفض أي URL يشير إلى عنوان داخلي، ويعيد الفحص عند كل redirect.
- حد لحجم الوسائط (`MAX_MEDIA_MB`) ومهلة 60 ثانية للتحميل.
- `/media` متاح من localhost فقط (للمتصفح الداخلي لـ Remotion).
- طابور رندر واحد لمنع استهلاك الذاكرة، وحذف تلقائي للملفات بعد `RETENTION_HOURS`.
- ملاحظة: الفحص لا يمنع DNS rebinding بشكل كامل. إن أردت حماية أشد، شغّل الخدمة في شبكة Docker معزولة بدون وصول للشبكة الداخلية.

## الترخيص

Remotion مجاني للأفراد والشركات حتى 3 أشخاص. راجع https://www.remotion.dev/docs/license
