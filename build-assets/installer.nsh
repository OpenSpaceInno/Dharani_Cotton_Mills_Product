; Dharani Weighbridge — NSIS Custom Script
!macro customInstall
  CreateDirectory "$APPDATA\Dharani Weighbridge"
  IfFileExists "$APPDATA\Dharani Weighbridge\server.env" +16 0
    FileOpen $0 "$APPDATA\Dharani Weighbridge\server.env" w
    FileWrite $0 "NODE_ENV=production$\r$\n"
    FileWrite $0 "PORT=3001$\r$\n"
    FileWrite $0 "DB_HOST=localhost$\r$\n"
    FileWrite $0 "DB_PORT=3306$\r$\n"
    FileWrite $0 "DB_USER=root$\r$\n"
    FileWrite $0 "DB_PASSWORD=dharani_db_pass$\r$\n"
    FileWrite $0 "DB_NAME=dharani_weighbridge$\r$\n"
    FileWrite $0 "PLANT_ID=PL01$\r$\n"
    FileWrite $0 "CLOUD_SYNC_ENABLED=true$\r$\n"
    FileWrite $0 "CLOUD_SYNC_INTERVAL_MS=300000$\r$\n"
    FileWrite $0 "CLOUD_SERVER_URL=https://cqvx5creel6qszofre5h3ofv.213.210.37.249.sslip.io$\r$\n"
    FileWrite $0 "CLOUD_SYNC_SECRET=Aparna_RMC_Cloud_Sync_Secret_2026!$\r$\n"
    FileClose $0
!macroend

!macro customUnInstall
!macroend
