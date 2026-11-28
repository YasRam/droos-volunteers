// The empty workbook to fill and upload with «رفع شيت»: exactly the layout studentSheet.ts reads.
const FORM_HEAD = [
  'طابع زمني', 'اسم الطالب', 'النوع', 'الرقم القومى للطالب', 'المرحلة الدراسية', 'حاله الطالب', 'اسم المدرسة', 'مواعيد المدرسة',
  'العنوان', 'اسم الاب', 'الرقم القومى لولى الامر', 'بطاقة ولى الامر سارية حتى', 'وظيفة ولى الامر', 'اسم الام', 'الرقم القومى للام',
  'بطاقة الام سارية حتى', 'وظيفة الام', 'رقم الهاتف', 'رقم محمول', 'رقم احد الاقارب', 'عدد الابناء اقل من 5 سنوات',
  'عدد الابناء من 5 سنوات الى 10 سنوات', 'عدد الاولاد اكبر من 10 سنوات', 'عدد البنات اكبر من 10 سنوات', 'ملاحظات هامة', 'ملاحظات', 'القبول',
]
const HINTS: Record<string, string> = {
  'طابع زمني': 'تاريخ التسجيل dd/mm/yyyy',
  'المرحلة الدراسية': 'زي 1ب أو 2ع',
  'حاله الطالب': 'مستجد أو مقيد',
  'مواعيد المدرسة': 'صباحي أو مسائي',
  'رقم الهاتف': 'رقم ولي الأمر الأساسي',
  'ملاحظات': 'الورق: تم / التحقق من الورق / ناقص',
  'القبول': 'انتظار / مقبول / مرفوض ...',
}

export async function downloadStudentTemplate(grades: string[], marks: string[]) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const bold = { bold: true }
  const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F2F1' } } as const

  const help = wb.addWorksheet('طريقة الملء', { views: [{ rightToLeft: true }] })
  help.columns = [{ width: 110 }]
  for (const line of [
    'الشيت ده بيترفع من «الطلاب ← رفع شيت». الأسماء والأعمدة لازم تفضل زي ما هي.',
    '',
    '1) «بيانات الطلاب»: سطر لكل طالب. الاسم والسنة الدراسية مهمين، والرقم القومي بيمنع التكرار.',
    '2) شيت لكل سنة دراسية باسمها (1 ب، 2 ب ... 3 ع): الطلاب في عمود الاسم، وكل عمود بعد كده حصة:',
    '   صف «المادة» + صف «نوع الحصة» + صف «التاريخ»، وتحت كل طالب علامته.',
    `   العلامات المقبولة: ${marks.join('، ')}`,
    '   الطالب اللي في شيت سنته بيتسجل «مقبول» في السنة دي.',
    '3) «انتظار»: قايمة الانتظار (الاسم، الرقم القومي، تليفونين، السنة).',
    '',
    'ينفع ترفع نفس الشيت أكتر من مرة: اللي اتغير بس هو اللي بيتحدّث، والخانات الفاضية مبتمسحش حاجة.',
  ])
    help.addRow([line])
  help.getRow(1).font = { bold: true, size: 13 }

  const form = wb.addWorksheet('بيانات الطلاب', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] })
  form.addRow(FORM_HEAD)
  form.getRow(1).font = bold
  form.getRow(1).eachCell((c) => (c.fill = fill))
  FORM_HEAD.forEach((h, i) => {
    form.getColumn(i + 1).width = Math.max(14, h.length + 4)
    if (HINTS[h]) form.getCell(1, i + 1).note = HINTS[h]
  })
  const list = (col: number, values: string[]) => {
    for (let r = 2; r <= 600; r++)
      form.getCell(r, col).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${values.join(',')}"`] }
  }
  list(3, ['ذكر', 'انثى'])
  list(5, grades.map((g) => g.replace(/\s+/g, '')))
  list(6, ['مستجد', 'مقيد'])
  list(8, ['صباحي', 'مسائي'])
  list(26, ['تم', 'التحقق من الورق', 'ناقص'])
  list(27, ['انتظار', 'لم يمتحن', 'انتظار التصحيح', 'إعادة امتحان', 'مقبول', 'مرفوض', 'بلاك ليست'])
  for (const c of [4, 11, 15, 18, 19, 20]) form.getColumn(c).numFmt = '@'

  for (const g of grades) {
    const ws = wb.addWorksheet(g, { views: [{ rightToLeft: true, state: 'frozen', xSplit: 2, ySplit: 4 }] })
    ws.getColumn(1).width = 5
    ws.getColumn(2).width = 30
    ws.getCell('B1').value = 'المادة'
    ws.getCell('B2').value = 'نوع الحصة'
    ws.getCell('B3').value = 'التاريخ'
    ws.getCell('A4').value = 'م'
    ws.getCell('B4').value = 'الاسم'
    for (const r of [1, 2, 3, 4]) {
      ws.getRow(r).font = bold
      ws.getCell(r, 2).fill = fill
    }
    for (let c = 5; c <= 40; c++) {
      ws.getColumn(c).width = 11
      ws.getCell(3, c).numFmt = 'dd/mm/yyyy'
      ws.getCell(2, c).dataValidation = { type: 'list', allowBlank: true, formulae: ['"اساسى,تأسيس,امتحان,غير دراسى,ملغى"'] }
      for (let r = 5; r <= 80; r++) ws.getCell(r, c).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${marks.join(',')}"`] }
    }
    for (let i = 1; i <= 60; i++) ws.getCell(4 + i, 1).value = i
  }

  const wait = wb.addWorksheet('انتظار', { views: [{ rightToLeft: true }] })
  wait.addRow(['الاسم', 'الرقم القومي', 'تليفون', 'تليفون تاني', 'السنة'])
  wait.getRow(1).font = bold
  wait.columns = [{ width: 30 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 8 }]
  wait.getColumn(2).numFmt = '@'

  const buf = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'شيت الطلاب - فاضي.xlsx'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
