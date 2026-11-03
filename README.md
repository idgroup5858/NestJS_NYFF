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