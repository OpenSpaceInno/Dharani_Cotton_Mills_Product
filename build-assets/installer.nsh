; Dharani Weighbridge — Custom NSIS Installer Script
; Runs during installation to configure app data directory
; and show MySQL prerequisite notice.

!macro customInstall
  ; Create AppData config directory for client env file
  CreateDirectory "$APPDATA\Dharani Weighbridge"
  
  ; Write a default server.env template if it does not already exist
  ; (preserves existing client config on reinstall / upgrade)
  IfFileExists "$APPDATA\Dharani Weighbridge\server.env" +2 0
    FileOpen $0 "$APPDATA\Dharani Weighbridge\server.env" w
    FileWrite $0 "# Dharani Weighbridge — Client Configuration$\r$\n"
    FileWrite $0 "# Edit this file to match your local MySQL installation.$\r$\n"
    FileWrite $0 "#$\r$\n"
    FileWrite $0 "NODE_ENV=production$\r$\n"
    FileWrite $0 "PORT=3001$\r$\n"
    FileWrite $0 "DB_HOST=localhost$\r$\n"
    FileWrite $0 "DB_PORT=3306$\r$\n"
    FileWrite $0 "DB_USER=root$\r$\n"
    FileWrite $0 "DB_PASSWORD=CHANGE_ME$\r$\n"
    FileWrite $0 "DB_NAME=dharani_weighbridge$\r$\n"
    FileWrite $0 "#$\r$\n"
    FileWrite $0 "# Central Server Sync (obtain from your IT administrator)$\r$\n"
    FileWrite $0 "PLANT_ID=PL01$\r$\n"
    FileWrite $0 "CLOUD_SYNC_ENABLED=true$\r$\n"
    FileWrite $0 "CLOUD_SYNC_INTERVAL_MS=300000$\r$\n"
    FileWrite $0 "CLOUD_SERVER_URL=$\r$\n"
    FileWrite $0 "CLOUD_SYNC_SECRET=$\r$\n"
    FileClose $0
  
  MessageBox MB_ICONINFORMATION|MB_OK \
    "Dharani Weighbridge installed successfully.$\r$\n$\r$\n\
IMPORTANT — MySQL Prerequisite:$\r$\n\
This application requires MySQL Server 8.0 or later.$\r$\n$\r$\n\
If MySQL is not installed, download it from:$\r$\n\
  https://dev.mysql.com/downloads/mysql/$\r$\n$\r$\n\
After MySQL is installed, edit the file:$\r$\n\
  %APPDATA%\Dharani Weighbridge\server.env$\r$\n\
to set your DB_PASSWORD and sync credentials.$\r$\n$\r$\n\
Contact your IT administrator for the CLOUD_SERVER_URL$\r$\n\
and CLOUD_SYNC_SECRET values." \
    /SD IDOK
!macroend

!macro customUnInstall
  ; Do NOT delete AppData on uninstall — preserve client database config
  ; and any locally cached data. User must manually remove if desired.
  MessageBox MB_ICONINFORMATION|MB_OK \
    "Dharani Weighbridge has been uninstalled.$\r$\n$\r$\n\
Your configuration and local data have been preserved at:$\r$\n\
  %APPDATA%\Dharani Weighbridge\$\r$\n$\r$\n\
Your MySQL database has NOT been deleted.$\r$\n\
To fully remove all data, delete the above folder and drop$\r$\n\
the 'dharani_weighbridge' MySQL database manually." \
    /SD IDOK
!macroend
