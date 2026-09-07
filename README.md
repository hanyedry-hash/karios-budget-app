# Kario's budget

אפליקציית תקציב משפחתית משותפת ל-Kario's budget.

## Supabase
הפרויקט מצפה לשני משתני סביבה:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (או legacy anon key)

אין להכניס לכאן service_role key.

## הרצה
```bash
npm install
npm run dev
```

## מה יש באפליקציה
- כניסה עם Supabase Auth
- דשבורד חודשי
- הכנסות והוצאות
- הוצאה מתוכננת מול בפועל
- הוצאות קבועות
- הוצאות קבועות/משתנות
- מי שילם/קיבל
- קטגוריות שניתן להוסיף מהאפליקציה
- התאמה למסכים של טלפון
Updated
