                    // .env global
                    npm i @nestjs/config
                    app.module write ConfigModule 


                    // database install 
                    npm install --save @nestjs/typeorm typeorm pg

                    // hash password
                    npm install @nestjs/jwt bcrypt
                    npm install @types/bcrypt --save-dev


                    //for payload token
                    npm install @nestjs/passport passport passport-jwt @nestjs/jwt
                    npm install -D @types/passport-jwt
                    create jwt.strategy add usermodule 


                    //validation
                    npm install class-validator class-transformer
                    main.ts write ValidationPipe


                    npm i nestjs-cls //shared preferences for nodejs

                    npm install @nestjs/websockets @nestjs/platform-socket.io socket.io



                    apt update
                    apt install -y curl ca-certificates
                    curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
                    apt install -y nodejs
                    hash -r
                    node -v





                    sudo apt install git -y

                    sudo apt update
                    sudo apt install -y postgresql postgresql-contrib
                    sudo systemctl status postgresql
                    sudo systemctl start postgresql
                    sudo systemctl restart postgresql
                    sudo systemctl enable postgresql


                    YANGI USER OCHISH
                    sudo -u postgres psql

                    CREATE USER myuser WITH PASSWORD 'root';
                    CREATE DATABASE prses OWNER myuser;
                    GRANT ALL PRIVILEGES ON DATABASE prses TO myuser;
                    \q

                    PAROLNI OZGARTIRISH
                    sudo -u postgres psql
                    ALTER USER postgres WITH PASSWORD 'root';
                    CREATE DATABASE prses OWNER postgres;
                    sudo -u postgres psql -l

                    \q

                    


                    DBeaverga ochish

                    1

                    sudo -u postgres psql -c "SHOW config_file;"
                    sudo nano /etc/postgresql/18/main/postgresql.conf
                    Ctrl+F #listen_addresses = 'localhost'
                    listen_addresses = '*'

                    2
                    sudo nano /etc/postgresql/18/main/pg_hba.conf
                    host    all             all             0.0.0.0/0               md5
                    host    all             all             SIZNING_IP/32           md5

                    Ctrl+O → Enter, Ctrl+X

                    3
                    sudo ufw allow 5432/tcp

                    sudo systemctl restart postgresql





                    npm install
                    npm run build
                    sudo npm install -g pm2
                    pm2 start dist/main.js --name nest-app

                    update backend

                    git pull
                    npm run build
                    pm2 restart 0


                    YANGI SERVER — BIRINCHI ISHGA TUSHIRISH (2026-11-02 dan demo ma'lumot yo'q)

                    cp .env.example .env      (DB_*, PORT, UI_DIST, GEMINI_API_KEY ni to'ldiring)
                    baza bo'sh bo'lsa server o'zi yaratadi:
                        admin:  admin@gmail.com / 123456789   (Admin Adminov)
                        "Markaziy ombor"
                    web: http://SERVER:3000/admin  → kirgach yuqori o'ngdagi "Profil" da email va parolni almashtiring
                    keyin admin panelda: filiallar (ombori o'zi ochiladi) → ombor mahsulotlari → kategoriya va taomlar
                        → xodimlar (kassir / oshpaz yordamchisi / ta'minotchi — PIN; kuryer — email va parol)
                    admin paroli unutilsa: boshqa admin "Xodimlar" da yangisini beradi yoki Telegram botda /parol

                    uploads (rasmlar) git'ga kirmaydi — git pull unga tegmaydi, papka bo'lmasa server o'zi yaratadi.
                    YO'QOLADI: loyiha papkasini o'chirib qayta klonlasangiz yoki git clean -fdx qilsangiz.
                    oylik zaxira nusxaga (Telegram) faqat baza ketadi — uploads ni o'zingiz nusxalab turing:
                    scp -r USER@SERVER:/BACKEND_PAPKASI/uploads ./uploads-zaxira


                    KASSA KOMPYUTERI — OFFLINE KASSA (internet yo'q paytda; batafsil API.md 14 va ../ElectronJS_NYFF/README.md)

                    1) YIG'ISH (ishlab chiqish kompyuterida):  cd ../ElectronJS_NYFF  →  npm install  →  npm run build
                       natija: ElectronJS_NYFF/dist/NYFF-Offline-Setup-<versiya>.exe  (markaziy server .env iga hech narsa yozilmaydi)

                    2) KASSA KOMPYUTERIDA (Windows) bir marta:
                       PostgreSQL o'rnating — foydalanuvchi postgres, parol root (baza nyff ni dastur o'zi ochadi)
                       NYFF-Offline-Setup.exe ni o'rnating → birinchi ochilishda sozlash oynasi:
                           Server manzili:  https://newyork24.uz  (standart qiymat)
                           Offline kalit:   admin panel → Filiallar → filial → «Offline kalit» → Nusxalash
                       «Saqlash» → dastur fonda (soat yonidagi belgi), Windows bilan birga yonadi

                    3) Online kassada: «Sozlamalar» → «Internet uzilsa offline rejimga o'tish» ni yoqing (manzil http://localhost:3100)

                    YANGILASH: yangi NYFF-Offline-Setup.exe ni ustidan o'rnating (sozlamalar va baza saqlanadi)

                    QOIDALAR: filialda offline faqat BITTA kassa kompyuterida; kassa kompyuteri soati to'g'ri bo'lsin;
                    offline'da smena ochilmaydi / yopilmaydi — smenani internet qaytib hammasi yuborilgach yoping.


                    RASMLAR (taom / kategoriya) — backendning uploads papkasida, git'ga kirmaydi
                    (admin yuklagan rasm ham shu yerga; ikonkalar — frontendda qoladi)

                    BIR MARTA, frontendni git pull qilishdan OLDIN — eski joydan ko'chirish (backend papkasida turib):
                    mkdir -p uploads
                    cp -rn ../ReactJS_NYFF/public/images/products ../ReactJS_NYFF/public/images/categories uploads/
                    yoki kompyuterdan (lokal uploads papkasini):
                    scp -r uploads/* USER@109.196.103.18:/BACKEND_PAPKASI/uploads/

                    frontend boshqa portda (Apache, 80) bo'lsa — build'da VITE_API_URL=http://109.196.103.18:3000,
                    shunda rasmlar backenddan olinadi. VITE_API_URL bo'lmasa (Apache /api ni proxy qilsa) —
                    /images/products va /images/categories ni ham 3000 ga proxy qiling.


                    update front

                    git pull
                    npm run build
                    sudo rm -rf /var/www/html/*
                    sudo cp -r dist/* /var/www/html/
                    sudo systemctl restart apache2



                    DBEAVER da foreign key ni sozlash

                    SELECT setval(pg_get_serial_sequence('"users"', 'id'), COALESCE(max(id), 1)) FROM "users";

                    DO $$
                        DECLARE
                            r RECORD;
                        BEGIN
                            FOR r IN 
                                SELECT table_name, column_name, pg_get_serial_sequence('"' || table_name || '"', column_name) as seq_name
                                FROM information_schema.columns 
                                WHERE table_schema = 'public' 
                                AND column_default LIKE 'nextval%'
                            LOOP
                                IF r.seq_name IS NOT NULL THEN
                                    EXECUTE format('SELECT setval(%L, COALESCE(max(%I), 1)) FROM %I', r.seq_name, r.column_name, r.table_name);
                                END IF;
                            END LOOP;
                        END $$;


















                    FRONT
                    FRONT
                    FRONT
                    FRONT
                    FRONT
                    FRONT
                    FRONT
                    FRONT
                    FRONT
                    FRONT




                git clone https://github.com/USERNAME/REPO_NAME.git

                cd my-vite-app

                sudo apt install -y apache2

                npm install



                npm run build


                sudo rm -rf /var/www/html/*
                sudo cp -r dist/* /var/www/html/
                sudo systemctl restart apache2

                /var/www/html ichida .htaccess yaratish:
                sudo touch /var/www/html/.htaccess


                sudo apt install nano -y
                sudo nano /var/www/html/.htaccess


                <IfModule mod_rewrite.c>
                RewriteEngine On
                RewriteBase /
                
                # Fayl yoki papka topilmasa index.html ga yo'naltirish
                RewriteCond %{REQUEST_FILENAME} !-f
                RewriteCond %{REQUEST_FILENAME} !-d
                RewriteRule . /index.html [L]
                </IfModule>
                
                
                Ctrl+O → Enter → Ctrl+X bilan saqlash va chiqish.




                .htaccess ishlashi uchun AllowOverride yoqilgan bo‘lishi kerak:
    
                sudo nano /etc/apache2/sites-available/000-default.conf
                
                
                <VirtualHost *:80> ichida qo‘shing yoki tekshiring:
                
                <Directory /var/www/html>
                    AllowOverride All
                </Directory>
                
                
                Saqlash → chiqish...    



                sudo a2enmod rewrite
                sudo systemctl restart apache2



               

                npm install react-to-print


                //update site
                git pull
                npm run build
                sudo rm -rf /var/www/html/*
                sudo cp -r dist/* /var/www/html/
                sudo systemctl restart apache2

                localhost
                109.196.103.18




                SERVER SETTINGS

                1. DNS (newyork24.uz provayderida)
                @ → A → yangi server IP
                www → CNAME → newyork24.uz

                Tekshirish (5-30 daqiqa ketishi mumkin):

                bash
                dig +short newyork24.uz

                Yangi server IP si chiqmaguncha 6-qadamga o’tmang.

                2. Hetzner Firewall

                Console → Firewalls da 22, 80, 443 ruxsat berilgan bo’lsin. 3000 ochilmasin.

                3. Serverga kirib, kerakli dasturlarni o’rnating
                bash
                ssh root@YANGI_SERVER_IP
                apt update && apt upgrade -y
                apt install -y apache2 certbot python3-certbot-apache git curl ufw

                # Node.js 22 va pm2
                curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
                apt install -y nodejs
                npm install -g pm2

                # Firewall
                ufw allow OpenSSH
                ufw allow 80,443/tcp
                ufw enable

                # Apache modullari
                a2enmod ssl proxy proxy_http proxy_wstunnel rewrite headers
                a2dissite 000-default.conf
                echo "ServerName localhost" > /etc/apache2/conf-available/servername.conf
                a2enconf servername
                4. Loyihalarni yuklang
                bash
                cd ~
                git clone <BACKEND_REPO_URL> newyork24-backend
                git clone <FRONTEND_REPO_URL> newyork24-frontend

                Repo private bo’lsa, GitHub token yoki SSH kalit kerak bo’ladi.

                5. Backendni ishga tushiring
                bash
                cd ~/newyork24-backend
                nano .env          # PORT=3000 va boshqa kerakli sozlamalar (DB va h.k.)
                npm install
                npm run build
                pm2 start dist/main.js --name newyork24
                pm2 save
                pm2 startup        # chiqargan buyruqni nusxalab ishga tushiring

                Tekshirish:

                bash
                ss -tlnp | grep 3000
                curl -i http://127.0.0.1:3000/api/health

                (Agar dist/main.js topilmasa, ls dist qiling. Birinchi loyihani qanday ishga tushirgan bo’lsangiz, shunday.) Ma’lumotlar bazasi ishlatsangiz (MongoDB, PostgreSQL va h.k.), uni ham shu serverga o’rnatish kerak bo’ladi, ayting.

                6. Frontendning birinchi build’i

                Frontendda API manzili nisbiy /api yoki https://newyork24.uz/api bo’lsin, Socket.IO uchun https://newyork24.uz. Keyin:

                bash
                cd ~/newyork24-frontend
                npm install
                npm run build
                rm -rf /var/www/html/*
                cp -r dist/* /var/www/html/
                chown -R www-data:www-data /var/www/html
                7. Avval HTTP sozlama (sertifikat olish uchun)
                bash
                nano /etc/apache2/sites-available/newyork24.uz.conf
                apache
                <VirtualHost *:80>
                    ServerName newyork24.uz
                    ServerAlias www.newyork24.uz
                    DocumentRoot /var/www/html
                </VirtualHost>
                bash
                a2ensite newyork24.uz.conf
                apache2ctl configtest && systemctl restart apache2
                certbot certonly --apache -d newyork24.uz -d www.newyork24.uz

                Email va shartlarga rozilik so’raydi. Oxirida sertifikat /etc/letsencrypt/live/newyork24.uz/ ga tushadi.

                8. Yakuniy sozlama (HTTP→HTTPS + proxy)

                Shu faylni to’liq almashtiring:

                bash
                > /etc/apache2/sites-available/newyork24.uz.conf
                nano /etc/apache2/sites-available/newyork24.uz.conf
                apache
                <VirtualHost *:80>
                    ServerName newyork24.uz
                    ServerAlias www.newyork24.uz
                    RewriteEngine On
                    RewriteRule ^ https://newyork24.uz%{REQUEST_URI} [R=301,L]
                </VirtualHost>

                <VirtualHost *:443>
                    ServerName newyork24.uz
                    ServerAlias www.newyork24.uz
                    DocumentRoot /var/www/html

                    <Directory /var/www/html>
                        Options -Indexes
                        Require all granted
                        FallbackResource /index.html
                    </Directory>

                    ProxyPreserveHost On
                    RequestHeader set X-Forwarded-Proto "https"

                    RewriteEngine On
                    RewriteCond %{HTTP:Upgrade} =websocket [NC]
                    RewriteRule ^/socket.io/(.*) ws://127.0.0.1:3000/socket.io/$1 [P,L]

                    ProxyPass /api http://127.0.0.1:3000/api
                    ProxyPassReverse /api http://127.0.0.1:3000/api
                    ProxyPass /socket.io http://127.0.0.1:3000/socket.io
                    ProxyPassReverse /socket.io http://127.0.0.1:3000/socket.io
                    ProxyPass /images http://127.0.0.1:3000/images
                    ProxyPassReverse /images http://127.0.0.1:3000/images

                    SSLEngine on
                    SSLCertificateFile /etc/letsencrypt/live/newyork24.uz/fullchain.pem
                    SSLCertificateKeyFile /etc/letsencrypt/live/newyork24.uz/privkey.pem
                </VirtualHost>

                Yopishtirgandan keyin ServerAlias www.newyork24.uz oddiy matn ekanini tekshiring (havolaga aylanib qolmasin). Keyin:

                bash
                apache2ctl configtest && systemctl restart apache2

                Backendda /images o’rniga boshqa yo’l bo’lsa (masalan /uploads), shu qatorlarni o’zgartiring.

                9. Tekshiring
                bash
                curl -i https://newyork24.uz/api/health
                curl -I http://newyork24.uz
                certbot renew --dry-run
                Birinchisida NestJS javobi (JSON) kelishi kerak.
                Ikkinchisida 301 va Location: https://newyork24.uz/... chiqishi kerak.
                Brauzerda https://newyork24.uz oching, ichki sahifada F5 bossangiz ham 404 chiqmasligi kerak.
                Har safar saytni yangilash

                Sizning usulingiz shu yerda ham ishlaydi, frontend papkasida:

                bash
                cd ~/newyork24-frontend
                git pull
                npm run build
                sudo rm -rf /var/www/html/*
                sudo cp -r dist/* /var/www/html/
                sudo systemctl restart apache2

                restart shart emas (fayllar almashishi bilan yangilanadi), lekin zarar ham qilmaydi.

                Backend yangilansa, alohida:

                bash
                cd ~/newyork24-backend
                git pull
                npm install
                npm run build
                pm2 restart newyork24

Android
                scp "C:\BACKEND APPS\Kotlin_NYFF\app\release\NYFF v2.apk" root@2.31.205.252:/root/Android/newyork24.apk



                mkdir -p /var/www/newyork24/app
                cp /root/Android/newyork24.apk /var/www/newyork24/app/
                chown -R www-data:www-data /var/www/newyork24/app

                nano /etc/apache2/sites-enabled/newyork24.uz.conf


                <Directory /var/www/newyork24/app>
                    AddType application/vnd.android.package-archive .apk
                    <FilesMatch "\.apk$">
                        Header set Cache-Control "no-cache"
                    </FilesMatch>
                </Directory>


                apachectl configtest && systemctl reload apache2


                curl -I https://newyork24.uz/app/newyork24.apk


                # Domen ildizi — vaqtinchalik bosh sahifa (logo)
                DocumentRoot /var/www/newyork24
                <Directory /var/www/newyork24>
                    Options -Indexes
                    Require all granted
                    FallbackResource /index.html
                </Directory>

                # Mijoz ilovasi (APK) — newyork24.uz/app/newyork24.apk
                <Directory /var/www/newyork24/app>
                    AddType application/vnd.android.package-archive .apk
                    <FilesMatch "\.apk$">
                        Header set Cache-Control "no-cache"
                    </FilesMatch>
                </Directory>

                # Xodimlar tizimi — newyork24.uz/shorva ...




                apachectl configtest && systemctl reload apache2
                curl -I https://newyork24.uz/app/newyork24.apk


                Keyingi versiyalarda faqat ikki buyruq kerak bo'ladi, Apache'ga boshqa tegilmaydi. versionCode ni oshirishni va APK'ni aynan shu kalit bilan imzolashni unutmang.


                scp "C:\...\yangi.apk" root@2.31.205.252:/root/Android/newyork24.apk

                cp /root/Android/newyork24.apk /var/www/newyork24/app/