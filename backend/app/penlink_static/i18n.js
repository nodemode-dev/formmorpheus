/* Pen Link companion strings, picked by the tablet's own language. Undo, Redo, Brush, Size and Opacity are the app's
   own words (frontend/src/ui/i18n); the rest are short sentences written for this page. English is the fallback. */
(function () {
  'use strict';
  var EN = {
    sub: 'Type the 6-digit code shown in formmorpheus on your computer.', connect: 'Connect', eraser: 'Eraser',
    ing: 'Connecting', ok: 'Connected', re: 'Reconnecting', digits: 'Type all 6 digits.', wrong: 'That code is wrong.',
    pairfail: 'Could not pair. Ask for a new code on the computer.', unreach: 'Could not reach the computer.',
    lost: 'The connection was lost. Ask for a new code.',
    undo: 'Undo', redo: 'Redo', brush: 'Brush', size: 'Size', opacity: 'Opacity'
  };
  var T = {
    ar: { sub: 'اكتب الرمز المكوّن من 6 أرقام المعروض في formmorpheus على حاسوبك.', connect: 'اتصال', eraser: 'الممحاة', ing: 'جارٍ الاتصال', ok: 'متصل', re: 'جارٍ إعادة الاتصال', digits: 'اكتب الأرقام الستة كلها.', wrong: 'الرمز غير صحيح.', pairfail: 'تعذّر الاقتران. اطلب رمزًا جديدًا على الحاسوب.', unreach: 'تعذّر الوصول إلى الحاسوب.', lost: 'انقطع الاتصال. اطلب رمزًا جديدًا.', undo: 'تراجع', redo: 'إعادة', brush: 'الفرشاة', size: 'الحجم', opacity: 'العتامة' },
    cs: { sub: 'Zadejte 6místný kód zobrazený ve formmorpheus na vašem počítači.', connect: 'Připojit', eraser: 'Guma', ing: 'Připojování', ok: 'Připojeno', re: 'Znovu se připojuje', digits: 'Zadejte všech 6 číslic.', wrong: 'Kód není správný.', pairfail: 'Spárování se nezdařilo. Vyžádejte si na počítači nový kód.', unreach: 'Počítač je nedostupný.', lost: 'Spojení bylo ztraceno. Vyžádejte si nový kód.', undo: 'Zpět', redo: 'Znovu', brush: 'Štětec', size: 'Velikost', opacity: 'Krytí' },
    da: { sub: 'Skriv den 6-cifrede kode, der vises i formmorpheus på din computer.', connect: 'Opret forbindelse', eraser: 'Viskelæder', ing: 'Forbinder', ok: 'Forbundet', re: 'Forbinder igen', digits: 'Skriv alle 6 cifre.', wrong: 'Koden er forkert.', pairfail: 'Parring mislykkedes. Bed om en ny kode på computeren.', unreach: 'Computeren kunne ikke nås.', lost: 'Forbindelsen blev afbrudt. Bed om en ny kode.', undo: 'Fortryd', redo: 'Gentag', brush: 'Pensel', size: 'Størrelse', opacity: 'Dækning' },
    de: { sub: 'Gib den 6-stelligen Code ein, der in formmorpheus auf deinem Computer angezeigt wird.', connect: 'Verbinden', eraser: 'Radierer', ing: 'Verbinde', ok: 'Verbunden', re: 'Verbinde erneut', digits: 'Gib alle 6 Ziffern ein.', wrong: 'Der Code ist falsch.', pairfail: 'Kopplung fehlgeschlagen. Fordere am Computer einen neuen Code an.', unreach: 'Der Computer ist nicht erreichbar.', lost: 'Die Verbindung wurde unterbrochen. Fordere einen neuen Code an.', undo: 'Rückgängig', redo: 'Wiederholen', brush: 'Pinsel', size: 'Größe', opacity: 'Deckkraft' },
    el: { sub: 'Πληκτρολογήστε τον 6ψήφιο κωδικό που εμφανίζεται στο formmorpheus στον υπολογιστή σας.', connect: 'Σύνδεση', eraser: 'Γόμα', ing: 'Σύνδεση σε εξέλιξη', ok: 'Συνδέθηκε', re: 'Επανασύνδεση', digits: 'Πληκτρολογήστε και τα 6 ψηφία.', wrong: 'Ο κωδικός είναι λάθος.', pairfail: 'Η σύζευξη απέτυχε. Ζητήστε νέο κωδικό στον υπολογιστή.', unreach: 'Δεν ήταν δυνατή η επικοινωνία με τον υπολογιστή.', lost: 'Η σύνδεση χάθηκε. Ζητήστε νέο κωδικό.', undo: 'Αναίρεση', redo: 'Επανάληψη', brush: 'Πινέλο', size: 'Μέγεθος', opacity: 'Αδιαφάνεια' },
    es: { sub: 'Escribe el código de 6 dígitos que aparece en formmorpheus en tu computadora.', connect: 'Conectar', eraser: 'Borrador', ing: 'Conectando', ok: 'Conectada', re: 'Reconectando', digits: 'Escribe los 6 dígitos.', wrong: 'El código es incorrecto.', pairfail: 'No se pudo emparejar. Pide un código nuevo en la computadora.', unreach: 'No se pudo contactar con la computadora.', lost: 'Se perdió la conexión. Pide un código nuevo.', undo: 'Deshacer', redo: 'Rehacer', brush: 'Pincel', size: 'Tamaño', opacity: 'Opacidad' },
    fi: { sub: 'Kirjoita tietokoneesi formmorpheus-ohjelmassa näkyvä 6-numeroinen koodi.', connect: 'Yhdistä', eraser: 'Pyyhekumi', ing: 'Yhdistetään', ok: 'Yhdistetty', re: 'Yhdistetään uudelleen', digits: 'Kirjoita kaikki 6 numeroa.', wrong: 'Koodi on väärä.', pairfail: 'Laiteparin muodostus epäonnistui. Pyydä tietokoneelta uusi koodi.', unreach: 'Tietokoneeseen ei saatu yhteyttä.', lost: 'Yhteys katkesi. Pyydä uusi koodi.', undo: 'Kumoa', redo: 'Tee uudelleen', brush: 'Sivellin', size: 'Koko', opacity: 'Peittävyys' },
    fr: { sub: 'Saisissez le code à 6 chiffres affiché dans formmorpheus sur votre ordinateur.', connect: 'Connecter', eraser: 'Gomme', ing: 'Connexion', ok: 'Connectée', re: 'Reconnexion', digits: 'Saisissez les 6 chiffres.', wrong: 'Ce code est incorrect.', pairfail: 'Appairage impossible. Demandez un nouveau code sur l\'ordinateur.', unreach: 'Impossible de joindre l\'ordinateur.', lost: 'La connexion a été perdue. Demandez un nouveau code.', undo: 'Annuler', redo: 'Rétablir', brush: 'Pinceau', size: 'Taille', opacity: 'Opacité' },
    hi: { sub: 'अपने कंप्यूटर पर formmorpheus में दिखाया गया 6 अंकों का कोड लिखें।', connect: 'कनेक्ट करें', eraser: 'रबर', ing: 'कनेक्ट हो रहा है', ok: 'कनेक्ट हो गया', re: 'फिर से कनेक्ट हो रहा है', digits: 'सभी 6 अंक लिखें।', wrong: 'यह कोड गलत है।', pairfail: 'जोड़ी नहीं बन सकी। कंप्यूटर पर नया कोड माँगें।', unreach: 'कंप्यूटर तक नहीं पहुँचा जा सका।', lost: 'कनेक्शन टूट गया। नया कोड माँगें।', undo: 'पूर्ववत करें', redo: 'फिर से करें', brush: 'ब्रश', size: 'आकार', opacity: 'अपारदर्शिता' },
    hu: { sub: 'Írd be a számítógépeden a formmorpheusban megjelenő 6 számjegyű kódot.', connect: 'Csatlakozás', eraser: 'Radír', ing: 'Csatlakozás folyamatban', ok: 'Csatlakoztatva', re: 'Újracsatlakozás', digits: 'Írd be mind a 6 számjegyet.', wrong: 'Hibás a kód.', pairfail: 'A párosítás nem sikerült. Kérj új kódot a számítógépen.', unreach: 'A számítógép nem érhető el.', lost: 'A kapcsolat megszakadt. Kérj új kódot.', undo: 'Visszavonás', redo: 'Újra', brush: 'Ecset', size: 'Méret', opacity: 'Átlátszatlanság' },
    id: { sub: 'Ketik kode 6 digit yang tampil di formmorpheus pada komputer Anda.', connect: 'Hubungkan', eraser: 'Penghapus', ing: 'Menghubungkan', ok: 'Terhubung', re: 'Menghubungkan ulang', digits: 'Ketik semua 6 digit.', wrong: 'Kode salah.', pairfail: 'Gagal memasangkan. Minta kode baru di komputer.', unreach: 'Tidak dapat menjangkau komputer.', lost: 'Koneksi terputus. Minta kode baru.', undo: 'Urungkan', redo: 'Ulangi', brush: 'Kuas', size: 'Ukuran', opacity: 'Opasitas' },
    it: { sub: 'Digita il codice di 6 cifre mostrato in formmorpheus sul computer.', connect: 'Connetti', eraser: 'Gomma', ing: 'Connessione', ok: 'Connesso', re: 'Riconnessione', digits: 'Digita tutte e 6 le cifre.', wrong: 'Il codice non è corretto.', pairfail: 'Associazione non riuscita. Chiedi un nuovo codice sul computer.', unreach: 'Impossibile raggiungere il computer.', lost: 'Connessione persa. Chiedi un nuovo codice.', undo: 'Annulla', redo: 'Ripeti', brush: 'Pennello', size: 'Dimensione', opacity: 'Opacità' },
    ja: { sub: 'コンピューターの formmorpheus に表示された6桁のコードを入力してください。', connect: '接続', eraser: '消しゴム', ing: '接続中', ok: '接続済み', re: '再接続中', digits: '6桁すべて入力してください。', wrong: 'コードが違います。', pairfail: 'ペアリングできませんでした。コンピューターで新しいコードを発行してください。', unreach: 'コンピューターに接続できませんでした。', lost: '接続が切れました。新しいコードを発行してください。', undo: '取り消し', redo: 'やり直し', brush: 'ブラシ', size: 'サイズ', opacity: '不透明度' },
    ko: { sub: '컴퓨터의 formmorpheus에 표시된 6자리 코드를 입력하세요.', connect: '연결', eraser: '지우개', ing: '연결하는 중', ok: '연결됨', re: '다시 연결하는 중', digits: '6자리를 모두 입력하세요.', wrong: '코드가 올바르지 않습니다.', pairfail: '페어링하지 못했습니다. 컴퓨터에서 새 코드를 요청하세요.', unreach: '컴퓨터에 연결할 수 없습니다.', lost: '연결이 끊어졌습니다. 새 코드를 요청하세요.', undo: '실행 취소', redo: '다시 실행', brush: '브러시', size: '크기', opacity: '불투명도' },
    nb: { sub: 'Skriv inn den 6-sifrede koden som vises i formmorpheus på datamaskinen din.', connect: 'Koble til', eraser: 'Viskelær', ing: 'Kobler til', ok: 'Tilkoblet', re: 'Kobler til igjen', digits: 'Skriv inn alle 6 sifrene.', wrong: 'Koden er feil.', pairfail: 'Paring mislyktes. Be om en ny kode på datamaskinen.', unreach: 'Fikk ikke kontakt med datamaskinen.', lost: 'Forbindelsen ble brutt. Be om en ny kode.', undo: 'Angre', redo: 'Gjør om', brush: 'Pensel', size: 'Størrelse', opacity: 'Dekkevne' },
    nl: { sub: 'Typ de 6-cijferige code die formmorpheus op je computer toont.', connect: 'Verbinden', eraser: 'Gum', ing: 'Verbinding maken', ok: 'Verbonden', re: 'Opnieuw verbinden', digits: 'Typ alle 6 cijfers.', wrong: 'Die code is onjuist.', pairfail: 'Koppelen mislukt. Vraag op de computer een nieuwe code aan.', unreach: 'De computer is niet bereikbaar.', lost: 'De verbinding is verbroken. Vraag een nieuwe code aan.', undo: 'Ongedaan maken', redo: 'Opnieuw', brush: 'Penseel', size: 'Grootte', opacity: 'Dekking' },
    pl: { sub: 'Wpisz 6-cyfrowy kod widoczny w formmorpheus na komputerze.', connect: 'Połącz', eraser: 'Gumka', ing: 'Łączenie', ok: 'Połączono', re: 'Ponowne łączenie', digits: 'Wpisz wszystkie 6 cyfr.', wrong: 'Kod jest nieprawidłowy.', pairfail: 'Nie udało się sparować. Poproś o nowy kod na komputerze.', unreach: 'Nie można połączyć się z komputerem.', lost: 'Połączenie zostało utracone. Poproś o nowy kod.', undo: 'Cofnij', redo: 'Ponów', brush: 'Pędzel', size: 'Rozmiar', opacity: 'Krycie' },
    'pt-BR': { sub: 'Digite o código de 6 dígitos mostrado no formmorpheus no seu computador.', connect: 'Conectar', eraser: 'Borracha', ing: 'Conectando', ok: 'Conectado', re: 'Reconectando', digits: 'Digite os 6 dígitos.', wrong: 'Esse código está errado.', pairfail: 'Não foi possível parear. Peça um novo código no computador.', unreach: 'Não foi possível alcançar o computador.', lost: 'A conexão foi perdida. Peça um novo código.', undo: 'Desfazer', redo: 'Refazer', brush: 'Pincel', size: 'Tamanho', opacity: 'Opacidade' },
    ru: { sub: 'Введите 6-значный код, показанный в formmorpheus на вашем компьютере.', connect: 'Подключиться', eraser: 'Ластик', ing: 'Подключение', ok: 'Подключено', re: 'Повторное подключение', digits: 'Введите все 6 цифр.', wrong: 'Неверный код.', pairfail: 'Не удалось выполнить сопряжение. Запросите новый код на компьютере.', unreach: 'Не удалось связаться с компьютером.', lost: 'Соединение потеряно. Запросите новый код.', undo: 'Отменить', redo: 'Повторить', brush: 'Кисть', size: 'Размер', opacity: 'Непрозрачность' },
    'sr-Latn': { sub: 'Unesite šestocifreni kôd prikazan u programu formmorpheus na računaru.', connect: 'Poveži', eraser: 'Gumica', ing: 'Povezivanje', ok: 'Povezano', re: 'Ponovno povezivanje', digits: 'Unesite svih 6 cifara.', wrong: 'Kôd nije tačan.', pairfail: 'Uparivanje nije uspelo. Zatražite novi kôd na računaru.', unreach: 'Računar nije dostupan.', lost: 'Veza je prekinuta. Zatražite novi kôd.', undo: 'Poništi', redo: 'Ponovi', brush: 'Četkica', size: 'Veličina', opacity: 'Neprozirnost' },
    sv: { sub: 'Skriv den 6-siffriga kod som visas i formmorpheus på datorn.', connect: 'Anslut', eraser: 'Suddgummi', ing: 'Ansluter', ok: 'Ansluten', re: 'Ansluter igen', digits: 'Skriv alla 6 siffror.', wrong: 'Koden är fel.', pairfail: 'Parkopplingen misslyckades. Be om en ny kod på datorn.', unreach: 'Det gick inte att nå datorn.', lost: 'Anslutningen bröts. Be om en ny kod.', undo: 'Ångra', redo: 'Gör om', brush: 'Pensel', size: 'Storlek', opacity: 'Opacitet' },
    th: { sub: 'พิมพ์รหัส 6 หลักที่แสดงใน formmorpheus บนคอมพิวเตอร์ของคุณ', connect: 'เชื่อมต่อ', eraser: 'ยางลบ', ing: 'กำลังเชื่อมต่อ', ok: 'เชื่อมต่อแล้ว', re: 'กำลังเชื่อมต่ออีกครั้ง', digits: 'พิมพ์ให้ครบ 6 หลัก', wrong: 'รหัสไม่ถูกต้อง', pairfail: 'จับคู่ไม่สำเร็จ ขอรหัสใหม่บนคอมพิวเตอร์', unreach: 'ไม่สามารถติดต่อคอมพิวเตอร์ได้', lost: 'การเชื่อมต่อขาดหาย ขอรหัสใหม่', undo: 'เลิกทำ', redo: 'ทำซ้ำ', brush: 'แปรง', size: 'ขนาด', opacity: 'ความทึบ' },
    tr: { sub: 'Bilgisayarınızdaki formmorpheus\'ta görünen 6 haneli kodu yazın.', connect: 'Bağlan', eraser: 'Silgi', ing: 'Bağlanıyor', ok: 'Bağlandı', re: 'Yeniden bağlanıyor', digits: '6 haneyi de yazın.', wrong: 'Kod yanlış.', pairfail: 'Eşleştirilemedi. Bilgisayarda yeni bir kod isteyin.', unreach: 'Bilgisayara ulaşılamadı.', lost: 'Bağlantı koptu. Yeni bir kod isteyin.', undo: 'Geri Al', redo: 'Yinele', brush: 'Fırça', size: 'Boyut', opacity: 'Opaklık' },
    uk: { sub: 'Введіть 6-значний код, показаний у formmorpheus на вашому комп\'ютері.', connect: 'Підключити', eraser: 'Гумка', ing: 'Підключення', ok: 'Підключено', re: 'Повторне підключення', digits: 'Введіть усі 6 цифр.', wrong: 'Хибний код.', pairfail: 'Не вдалося створити пару. Запросіть новий код на комп\'ютері.', unreach: 'Не вдалося зв\'язатися з комп\'ютером.', lost: 'З\'єднання втрачено. Запросіть новий код.', undo: 'Скасувати', redo: 'Повторити', brush: 'Пензель', size: 'Розмір', opacity: 'Непрозорість' },
    vi: { sub: 'Nhập mã 6 chữ số hiển thị trong formmorpheus trên máy tính của bạn.', connect: 'Kết nối', eraser: 'Cục tẩy', ing: 'Đang kết nối', ok: 'Đã kết nối', re: 'Đang kết nối lại', digits: 'Hãy nhập đủ 6 chữ số.', wrong: 'Mã không đúng.', pairfail: 'Không ghép đôi được. Hãy yêu cầu mã mới trên máy tính.', unreach: 'Không thể kết nối tới máy tính.', lost: 'Mất kết nối. Hãy yêu cầu mã mới.', undo: 'Hoàn tác', redo: 'Làm lại', brush: 'Cọ', size: 'Kích thước', opacity: 'Độ mờ đục' },
    'zh-CN': { sub: '输入电脑上 formmorpheus 显示的 6 位代码。', connect: '连接', eraser: '橡皮擦', ing: '正在连接', ok: '已连接', re: '正在重新连接', digits: '请输入全部 6 位数字。', wrong: '代码不正确。', pairfail: '配对失败。请在电脑上获取新代码。', unreach: '无法连接到电脑。', lost: '连接已断开。请获取新代码。', undo: '还原', redo: '重做', brush: '画笔', size: '大小', opacity: '不透明度' },
    'zh-TW': { sub: '輸入電腦上 formmorpheus 顯示的 6 位數代碼。', connect: '連線', eraser: '橡皮擦', ing: '連線中', ok: '已連線', re: '重新連線中', digits: '請輸入全部 6 位數字。', wrong: '代碼不正確。', pairfail: '配對失敗。請在電腦上取得新代碼。', unreach: '無法連線到電腦。', lost: '連線已中斷。請取得新代碼。', undo: '還原', redo: '重做', brush: '筆刷', size: '尺寸', opacity: '不透明度' }
  };
  var IDLE = {
    en: 'Open a Drawing or Flipbook in Draw & Paint on your computer to draw here.',
    ar: 'افتح رسمًا أو فليب بوك في «الرسم والتلوين» على حاسوبك لترسم هنا.',
    cs: 'Otevřete na počítači kresbu nebo flipbook v Kreslení a malování a kreslete zde.',
    da: 'Åbn en tegning eller en flipbook i Tegn og mal på din computer for at tegne her.',
    de: 'Öffne am Computer eine Zeichnung oder ein Flipbook in Zeichnen und Malen, um hier zu zeichnen.',
    el: 'Ανοίξτε ένα σχέδιο ή ένα flipbook στο Σχεδίαση και ζωγραφική στον υπολογιστή σας για να σχεδιάσετε εδώ.',
    es: 'Abre un dibujo o un flipbook en Dibujar y pintar en tu computadora para dibujar aquí.',
    fi: 'Avaa piirros tai flipbook Piirrä ja maalaa -tilassa tietokoneella, niin voit piirtää tässä.',
    fr: 'Ouvrez un dessin ou un flipbook dans Dessiner et peindre sur votre ordinateur pour dessiner ici.',
    hi: 'यहाँ चित्र बनाने के लिए अपने कंप्यूटर पर ड्रॉ और पेंट में कोई ड्रॉइंग या फ्लिपबुक खोलें।',
    hu: 'Nyiss meg egy rajzot vagy flipbookot a Rajzolás és festés módban a számítógépen, hogy itt rajzolhass.',
    id: 'Buka Gambar atau Flipbook di Gambar & Lukis pada komputer Anda untuk menggambar di sini.',
    it: 'Apri un disegno o un flipbook in Disegna e dipingi sul computer per disegnare qui.',
    ja: 'ここで描くには、コンピューターで「描画とペイント」を開き、ドローイングまたはフリップブックを開いてください。',
    ko: '여기서 그리려면 컴퓨터에서 그리기 및 페인트로 드로잉이나 플립북을 여세요.',
    nb: 'Åpne en tegning eller en flipbook i Tegn og mal på datamaskinen for å tegne her.',
    nl: 'Open op je computer een tekening of flipbook in Tekenen en schilderen om hier te tekenen.',
    pl: 'Otwórz na komputerze rysunek lub flipbook w Rysowaniu i malowaniu, aby rysować tutaj.',
    'pt-BR': 'Abra um desenho ou flipbook em Desenhar e pintar no computador para desenhar aqui.',
    ru: 'Откройте на компьютере рисунок или флипбук в режиме «Рисование и живопись», чтобы рисовать здесь.',
    'sr-Latn': 'Otvorite crtež ili flipbook u Crtanju i slikanju na računaru da biste ovde crtali.',
    sv: 'Öppna en teckning eller en flipbook i Rita och måla på datorn för att rita här.',
    th: 'เปิดภาพวาดหรือฟลิปบุ๊กใน วาดและระบายสี บนคอมพิวเตอร์เพื่อวาดที่นี่',
    tr: 'Burada çizmek için bilgisayarınızda Çiz ve Boya\'da bir çizim veya flipbook açın.',
    uk: 'Відкрийте на комп\'ютері малюнок або фліпбук у режимі «Малювання і живопис», щоб малювати тут.',
    vi: 'Hãy mở một bản vẽ hoặc flipbook trong Vẽ và tô màu trên máy tính để vẽ tại đây.',
    'zh-CN': '请在电脑上的“绘画”中打开一个绘图或翻页动画，即可在此绘制。',
    'zh-TW': '請在電腦上的「繪圖」中開啟繪圖或翻頁動畫，即可在此繪製。'
  };
  EN.idle = IDLE.en;
  for (var lk in IDLE) if (T[lk]) T[lk].idle = IDLE[lk];
  var RTL = { ar: 1 };

  /* the first of the tablet's languages that the table has; a regional code falls back to its language */
  function pick() {
    var list = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en']);
    for (var i = 0; i < list.length; i++) {
      var code = String(list[i] || ''), low = code.toLowerCase(), base = low.split('-')[0];
      if (low === 'zh-tw' || low === 'zh-hk' || low === 'zh-hant' || low.indexOf('zh-hant') === 0) return 'zh-TW';
      if (base === 'zh') return 'zh-CN';
      if (base === 'pt') return 'pt-BR';
      if (base === 'sr') return 'sr-Latn';
      if (base === 'no' || base === 'nn') return 'nb';
      if (T[base]) return base;
      if (base === 'en') return 'en';
    }
    return 'en';
  }

  var lang = pick();
  var table = lang === 'en' ? EN : T[lang];
  window.PL = {
    lang: lang,
    t: function (k) { return (table && table[k]) || EN[k] || k; }
  };

  /* the static page: every [data-i] element takes the text under its key; data-i-label sets aria-label */
  function apply() {
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL[lang] ? 'rtl' : 'ltr';
    var nodes = document.querySelectorAll('[data-i]');
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = window.PL.t(nodes[i].getAttribute('data-i'));
    var lab = document.querySelectorAll('[data-i-label]');
    for (var j = 0; j < lab.length; j++) lab[j].setAttribute('aria-label', window.PL.t(lab[j].getAttribute('data-i-label')));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
})();
