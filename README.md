# ฟามCENT

เว็บแอป PWA แนวกระเป๋าคำนวณการเทรดส่วนตัว สำหรับบันทึกกำไร XAUUSDc รายวันโดยใช้ USC เป็นหน่วยหลัก และแปลงเป็น USD/THB อัตโนมัติ รองรับกำไร ขาดทุน Commission, Swap, ค่าใช้จ่ายอื่น เงินฝาก ถอน โบรกเกอร์หลายบัญชี Dashboard สถิติ ถังขยะ กู้คืน และส่งออก CSV

## สูตรหลัก

`กำไรสุทธิ USC = กำไรก่อนค่าใช้จ่าย + Commission + Swap + ค่าใช้จ่ายอื่น`

`USD = USC ÷ USC ต่อ 1 USD` โดยค่าเริ่มต้นบัญชี Cent คือ `100 USC = 1 USD`

`THB = USD × อัตรา USD/THB ที่บันทึกในรายการ`

เมื่อเชื่อม Google Sheets แอปจะดึง USD/THB อ้างอิงล่าสุดตอนเปิดแอป กลับมาออนไลน์ และทุก 30 นาที พร้อมเก็บเรตประจำรายการเพื่อไม่ให้ยอดย้อนหลังเปลี่ยน

## Google Sheets

ดูคู่มือภาษาไทยใน `google-apps-script/SETUP_TH.md` จากนั้นนำ URL และ Device Credential ไปกรอกในหน้าตั้งค่าของแอป

## GitHub Pages

Workflow ใน `.github/workflows/deploy-pages.yml` จะสร้างและเผยแพร่เว็บอัตโนมัติเมื่อ push ไป branch `main` เปิด Pages source เป็น **GitHub Actions** ใน Settings ของ repository ก่อนใช้งานครั้งแรก

ข้อมูลและรหัสอุปกรณ์ไม่ถูกเก็บใน repository ตัวเว็บที่เผยแพร่มีเฉพาะส่วนติดต่อผู้ใช้
