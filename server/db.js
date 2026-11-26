import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import './config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const poolConfigBase = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD ?? '',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE) || 10,
  queueLimit: 0,
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  multipleStatements: true,
  timezone: process.env.TZ === 'Asia/Kolkata' ? '+05:30' : (process.env.DB_TIMEZONE || '+05:30')
};

// Create connection pool (without database selection initially)
const poolWithoutDb = mysql.createPool(poolConfigBase);

// Create connection pool (with database)
const pool = mysql.createPool({
  ...poolConfigBase,
  database: process.env.DB_NAME || 'dharani_weighbridge',
});

// Test connection
async function testConnection() {
  const dbName = process.env.DB_NAME || 'dharani_weighbridge';
  try {
    // First, create database if it doesn't exist
    const connection = await poolWithoutDb.getConnection();
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
    connection.release();
    
    // Then test connection to the database
    const dbConnection = await pool.getConnection();
    console.log('✅ MySQL Database connected successfully!');
    dbConnection.release();
    return true;
  } catch (error) {
    console.error('❌ MySQL connection failed:', error.message);
    return false;
  }
}

// Initialize database and tables
async function initializeDatabase() {
  const dbName = process.env.DB_NAME || 'dharani_weighbridge';
  try {
    const connection = await poolWithoutDb.getConnection();
    
    // Create database if it doesn't exist
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
    console.log(`✅ Database '${dbName}' ready`);
    connection.release();
    
    // Now use the database connection pool
    const dbConnection = await pool.getConnection();

    // Check if the users table already exists
    const [userTables] = await dbConnection.query(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'",
      [dbName]
    );

    // If users table is missing, run full schema initialization from init.sql
    if (userTables.length === 0) {
      console.log('🔄 Core tables missing. Initializing complete schema from init.sql...');
      const initSqlPath = path.resolve(__dirname, 'init.sql');
      if (fs.existsSync(initSqlPath)) {
        try {
          let sqlContent = fs.readFileSync(initSqlPath, 'utf8');
          if (dbName !== 'dharani_weighbridge') {
            sqlContent = sqlContent.replace(/`dharani_weighbridge`/g, `\`${dbName}\``);
          }
          await dbConnection.query(sqlContent);
          console.log('✅ Complete schema & seed data initialized from init.sql!');
        } catch (sqlErr) {
          console.error('⚠️ Warning executing init.sql batch:', sqlErr.message);
        }
      }
    }
    
    // Ensure roles table exists
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(128) NOT NULL,
        description TEXT,
        color VARCHAR(32) DEFAULT 'blue',
        modules JSON,
        permissions JSON,
        is_system BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Ensure default roles exist without overwriting user customizations
    await dbConnection.query(`
      INSERT IGNORE INTO roles (id, name, description, color, modules, permissions, is_system)
      VALUES 
        (
          'super_admin',
          'Super Admin',
          'Executive Super Administrator with complete, unrestricted access across all plant terminals, gate security, weighbridge scale, reports, device configurations, company settings, and user authorization matrices.',
          'red',
          '["/","/gate-monitor","/weighbridge","/reports","/device-config","/settings","/company-settings","/users"]',
          '["all:manage","weighbridge:operate","weighbridge:print","gate:view","reports:export","config:manage","users:manage","roles:manage","override:approve"]',
          TRUE
        ),
        (
          'admin',
          'Plant Head / Admin',
          'Executive leadership with plant-wide visibility, multi-camera CCTV wall, operational modules, and report generation.',
          'purple',
          '["/","/gate-monitor","/weighbridge","/reports","/settings","/company-settings"]',
          '["reports:export","override:approve","gate:view","weighbridge:operate","weighbridge:print"]',
          TRUE
        ),
        (
          'weighbridge_operator',
          'Weighbridge Scale',
          'Scale operator with digital indicator access, gross/tare weighment capture, slip printing, and vehicle queue management.',
          'blue',
          '["/","/gate-monitor","/weighbridge"]',
          '["weighbridge:operate","weighbridge:print"]',
          TRUE
        ),
        (
          'gate_operator',
          'Gate Security',
          'Security officer with live multi-camera gate surveillance, automatic number plate recognition (ANPR), and vehicle entry logging.',
          'emerald',
          '["/","/gate-monitor"]',
          '["gate:view"]',
          TRUE
        );
    `);

    // Ensure users table exists
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        username VARCHAR(64) UNIQUE NOT NULL,
        name VARCHAR(128) NOT NULL,
        email VARCHAR(128) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role_id VARCHAR(64) NOT NULL,
        role_name VARCHAR(128) NOT NULL,
        phone VARCHAR(32),
        department VARCHAR(64),
        shift VARCHAR(64),
        status VARCHAR(32) DEFAULT 'active',
        avatar VARCHAR(255),
        last_login TIMESTAMP NULL,
        plant_id VARCHAR(64) DEFAULT 'PL01',
        plant_name VARCHAR(128) DEFAULT 'Plant 01 • Shamshabad Central',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_users_role (role_id),
        INDEX idx_users_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Ensure default users exist without overwriting passwords or profiles
    await dbConnection.query(`
      INSERT IGNORE INTO users (id, username, name, email, password_hash, role_id, role_name, status)
      VALUES 
        ('USR-000', 'superadmin', 'Super Administrator', 'superadmin@dharanicotton.com', 'superadmin123', 'super_admin', 'Super Admin', 'active'),
        ('USR-001', 'admin', 'Rajesh Sharma', 'admin@dharanicotton.com', 'admin123', 'admin', 'Plant Head / Admin', 'active'),
        ('USR-002', 'gate.security', 'Mahesh Patil', 'security@dharanicotton.com', 'gate123', 'gate_operator', 'Gate Security', 'active'),
        ('USR-003', 'weighbridge.op', 'Ramesh Kulkarni', 'weighbridge@dharanicotton.com', 'scale123', 'weighbridge_operator', 'Weighbridge Scale', 'active');
    `);

    // Ensure audit_logs table exists
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id VARCHAR(64) PRIMARY KEY,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        module VARCHAR(64) NOT NULL,
        action VARCHAR(64) NOT NULL,
        entity_id VARCHAR(128),
        entity_type VARCHAR(128),
        performed_by JSON,
        details TEXT,
        severity VARCHAR(32) DEFAULT 'info',
        user_id VARCHAR(64),
        user_name VARCHAR(128),
        status VARCHAR(32) DEFAULT 'SUCCESS',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_module (module),
        INDEX idx_audit_timestamp (timestamp)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Create camera_devices table
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS camera_devices (
        id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
        device_id VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        model VARCHAR(100) NOT NULL,
        location VARCHAR(50) NOT NULL,
        ip_address VARCHAR(45) NOT NULL,
        mac_address VARCHAR(17),
        status VARCHAR(20) NOT NULL DEFAULT 'offline',
        last_seen DATETIME,
        firmware VARCHAR(50),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_device_id (device_id),
        INDEX idx_location (location),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    
    // Create device_rtsp_config table
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS device_rtsp_config (
        id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
        device_id VARCHAR(50) UNIQUE NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        url TEXT,
        direct_url TEXT,
        use_direct_url BOOLEAN NOT NULL DEFAULT TRUE,
        port INT NOT NULL DEFAULT 554,
        username VARCHAR(255),
        password VARCHAR(255),
        stream_path VARCHAR(500) NOT NULL DEFAULT '/rtsp/streaming?channel=01&subtype=0',
        transport VARCHAR(10) NOT NULL DEFAULT 'tcp',
        reconnect_interval INT NOT NULL DEFAULT 5,
        buffer_size INT NOT NULL DEFAULT 1024,
        low_latency_mode BOOLEAN NOT NULL DEFAULT TRUE,
        hls_proxy_url TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (device_id) REFERENCES camera_devices(device_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    
    // Create device_network_config table
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS device_network_config (
        id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
        device_id VARCHAR(50) UNIQUE NOT NULL,
        ip_address VARCHAR(45) NOT NULL,
        subnet_mask VARCHAR(45) NOT NULL DEFAULT '255.255.255.0',
        gateway VARCHAR(45) NOT NULL,
        primary_dns VARCHAR(45) NOT NULL DEFAULT '8.8.8.8',
        secondary_dns VARCHAR(45) DEFAULT '8.8.4.4',
        dhcp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (device_id) REFERENCES camera_devices(device_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Ensure default camera devices exist
    await dbConnection.query(`
      INSERT INTO camera_devices (device_id, name, model, location, ip_address, status)
      VALUES 
        ('cam_gate_1', 'Gate 1 Inbound ANPR Camera', 'Hikvision / GeoVision ANPR', 'Main Inbound Gate', '192.168.0.101', 'online'),
        ('cam_scale_1', 'Weighbridge Scale Overhead Cam', 'Industrial IP CCTV Bullet', 'Weighbridge Platform 1', '192.168.0.102', 'online')
      ON DUPLICATE KEY UPDATE name=VALUES(name), ip_address=VALUES(ip_address);
    `);

    await dbConnection.query(`
      INSERT INTO device_rtsp_config (device_id, url, direct_url, hls_proxy_url, stream_path, port, enabled)
      VALUES 
        ('cam_gate_1', 'rtsp://admin:admin123@192.168.0.101:554/rtsp/streaming?channel=01&subtype=0', 'rtsp://admin:admin123@192.168.0.101:554/rtsp/streaming?channel=01&subtype=0', 'http://localhost:8888/cam1/', '/rtsp/streaming?channel=01&subtype=0', 554, 1),
        ('cam_scale_1', 'rtsp://admin:admin123@192.168.0.102:554/rtsp/streaming?channel=01&subtype=0', 'rtsp://admin:admin123@192.168.0.102:554/rtsp/streaming?channel=01&subtype=0', 'http://localhost:8888/cam2/', '/rtsp/streaming?channel=01&subtype=0', 554, 1)
      ON DUPLICATE KEY UPDATE hls_proxy_url=VALUES(hls_proxy_url);
    `);

    // Create weighbridge_devices table
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS weighbridge_devices (
        id VARCHAR(64) PRIMARY KEY,
        device_code VARCHAR(64) DEFAULT 'VMS',
        display_name VARCHAR(128) DEFAULT 'Ventek Scale Indicator',
        manufacturer VARCHAR(100) DEFAULT 'VENTEK',
        model VARCHAR(100) DEFAULT 'VMS-WB',
        serial_number VARCHAR(100) DEFAULT '168',
        capacity_kg INT DEFAULT 50000,
        port VARCHAR(32) DEFAULT 'COM3',
        baud_rate INT DEFAULT 2400,
        interface_type VARCHAR(32) DEFAULT 'RS232',
        data_bits INT DEFAULT 8,
        stop_bits INT DEFAULT 1,
        parity VARCHAR(32) DEFAULT 'none',
        sample_time_ms INT DEFAULT 1000,
        byte_range VARCHAR(32) DEFAULT '1-8',
        unit_type VARCHAR(32) DEFAULT 'Qtl',
        mode VARCHAR(32) DEFAULT 'serial',
        file_path VARCHAR(255) DEFAULT 'C:\\Weighbridge\\live_weight.txt',
        tcp_host VARCHAR(64) DEFAULT '127.0.0.1',
        tcp_port INT DEFAULT 4001,
        is_active BOOLEAN DEFAULT TRUE,
        status VARCHAR(32) DEFAULT 'online',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [existingWdCols] = await dbConnection.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'weighbridge_devices'`,
      [dbName]
    );
    const wdColSet = new Set(existingWdCols.map(c => c.COLUMN_NAME.toLowerCase()));
    const requiredWdCols = [
      { name: 'mode', type: "VARCHAR(32) DEFAULT 'serial'" },
      { name: 'file_path', type: "VARCHAR(255) DEFAULT 'C:\\\\Weighbridge\\\\live_weight.txt'" },
      { name: 'tcp_host', type: "VARCHAR(64) DEFAULT '127.0.0.1'" },
      { name: 'tcp_port', type: 'INT DEFAULT 4001' },
      { name: 'status', type: "VARCHAR(32) DEFAULT 'online'" },
    ];
    for (const col of requiredWdCols) {
      if (!wdColSet.has(col.name.toLowerCase())) {
        try {
          await dbConnection.query(`ALTER TABLE weighbridge_devices ADD COLUMN \`${col.name}\` ${col.type}`);
        } catch (e) {
          console.warn(`Could not add column ${col.name} to weighbridge_devices:`, e.message);
        }
      }
    }

    await dbConnection.query(`
      INSERT INTO weighbridge_devices 
        (id, device_code, display_name, manufacturer, model, serial_number, capacity_kg, port, baud_rate, interface_type, mode, is_active, status)
      VALUES 
        ('dev-scale-01', 'VMS', 'Ventek VMS-WB Indicator (COM3)', 'VENTEK', 'VMS-WB', '168', 50000, 'COM3', 2400, 'RS232', 'serial', 1, 'online'),
        ('dev-scale-02', 'AVERY', 'Avery Weight-Tronix E1205 (Backup)', 'Avery Weigh-Tronix', 'E1205', 'AV-9921', 100000, 'COM4', 9600, 'RS232', 'file_monitor', 0, 'standby')
      ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);
    `);

    // Create printer_devices table
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS printer_devices (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(128) NOT NULL,
        model VARCHAR(128) DEFAULT 'Epson POS-80',
        type VARCHAR(64) DEFAULT 'thermal_80mm',
        connection_type VARCHAR(64) DEFAULT 'system',
        ip_address VARCHAR(45) NULL,
        port INT DEFAULT 9100,
        paper_size VARCHAR(32) DEFAULT '80mm',
        copies INT DEFAULT 1,
        auto_print_on_completion BOOLEAN DEFAULT FALSE,
        print_qr_code BOOLEAN DEFAULT TRUE,
        print_images BOOLEAN DEFAULT TRUE,
        is_default BOOLEAN DEFAULT FALSE,
        status VARCHAR(32) DEFAULT 'online',
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await dbConnection.query(`
      INSERT INTO printer_devices
        (id, name, model, type, connection_type, paper_size, copies, auto_print_on_completion, print_qr_code, print_images, is_default, status)
      VALUES
        ('prn-01', 'Primary Weigh Slip Printer', 'Thermal POS-80 Roll', 'thermal_80mm', 'system', '80mm Roll', 1, 0, 1, 1, 1, 'online'),
        ('prn-02', 'Dot Matrix Archive Printer', 'Epson LX-310 (Continuous 3-Ply)', 'dot_matrix', 'system', 'Continuous 10x12', 2, 0, 0, 0, 0, 'online')
      ON DUPLICATE KEY UPDATE name=VALUES(name);
    `);

    // Create ftp_configs table
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS ftp_configs (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(128) NOT NULL,
        host VARCHAR(255) NOT NULL,
        port INT DEFAULT 2121,
        username VARCHAR(128) NOT NULL,
        password VARCHAR(255) NOT NULL,
        remote_dir VARCHAR(255) DEFAULT '/Dharani',
        secure BOOLEAN DEFAULT FALSE,
        passive BOOLEAN DEFAULT TRUE,
        is_active BOOLEAN DEFAULT TRUE,
        status VARCHAR(32) DEFAULT 'online',
        purpose VARCHAR(64) DEFAULT 'anpr_snapshots',
        last_test_at DATETIME NULL,
        last_test_status VARCHAR(32) NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await dbConnection.query(`
      INSERT INTO ftp_configs
        (id, name, host, port, username, password, remote_dir, secure, passive, is_active, status, purpose)
      VALUES
        ('ftp-anpr-01', 'Cloud FTP Camera Storage (activitsol)', 'ftp.activitsol.com', 2121, 'demo', 'Password@123', '/Dharani', 0, 1, 1, 'online', 'anpr_snapshots'),
        ('ftp-backup-02', 'Secondary Central Server Backup', '213.210.37.249', 2121, 'rmc_backup', 'Password@123', '/weighbridge_backup', 0, 1, 0, 'standby', 'cloud_backup')
      ON DUPLICATE KEY UPDATE name=VALUES(name);
    `);

    // Create company_settings table
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS company_settings (
        id VARCHAR(64) PRIMARY KEY,
        company_name VARCHAR(255) DEFAULT 'Dharani Cotton Mills',
        firm_name VARCHAR(255) DEFAULT 'Dharani Cotton Mills',
        plant_name VARCHAR(255) DEFAULT 'Plant 1 - Main Batching Yard',
        plant_code VARCHAR(64) DEFAULT 'PLANT_001',
        tagline VARCHAR(255) DEFAULT 'Certified Electronic Weighbridge & Automated Concrete Dispatch',
        logo_url LONGTEXT,
        address TEXT,
        city VARCHAR(100) DEFAULT 'Hyderabad',
        state VARCHAR(100) DEFAULT 'Telangana',
        pincode VARCHAR(20) DEFAULT '500033',
        phone VARCHAR(50) DEFAULT '+91 20 2712 8899',
        email VARCHAR(100) DEFAULT 'weighbridge@dharanicotton.com',
        website VARCHAR(255) DEFAULT 'https://www.dharanicotton.com',
        gstin VARCHAR(50) DEFAULT '27AAAAA0000A1Z5',
        weighbridge_license VARCHAR(100) DEFAULT 'WB/2026/RMC-449',
        scale_model VARCHAR(100) DEFAULT 'VENTEK VMS-WB',
        scale_capacity VARCHAR(50) DEFAULT '50,000 kg (50 MT)',
        scale_division VARCHAR(50) DEFAULT '10 kg',
        currency VARCHAR(10) DEFAULT '₹',
        weighbridge_defaults JSON,
        invoice_terms TEXT,
        weigh_slip_notes TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await dbConnection.query(`
      INSERT INTO company_settings (id, company_name, firm_name, plant_name, plant_code)
      VALUES ('default_company', 'Dharani Cotton Mills', 'Dharani Cotton Mills', 'Plant 1 - Main Batching Yard', 'PLANT_001')
      ON DUPLICATE KEY UPDATE company_name='Dharani Cotton Mills', firm_name='Dharani Cotton Mills'
    `);

    // Create anpr_events table
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS anpr_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        event_id VARCHAR(100) NOT NULL UNIQUE,
        event_type VARCHAR(50) DEFAULT 'ANPR_READ',
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        plant_id VARCHAR(50) DEFAULT 'plant_001',
        camera_id VARCHAR(50) DEFAULT 'cam_gate_1',
        vehicle_reg_no VARCHAR(50) NOT NULL,
        confidence DECIMAL(5,4) DEFAULT 0.9800,
        source VARCHAR(100) DEFAULT 'ANPR Camera (FTP /Dharani)',
        status VARCHAR(50) DEFAULT 'confirmed',
        operator_note TEXT NULL,
        vehicle_type VARCHAR(50) NULL,
        direction VARCHAR(20) DEFAULT 'entry',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_anpr_time (timestamp),
        INDEX idx_anpr_plate (vehicle_reg_no),
        INDEX idx_anpr_plant (plant_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Create anpr_evidence table
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS anpr_evidence (
        id INT AUTO_INCREMENT PRIMARY KEY,
        event_id VARCHAR(100) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_url TEXT NOT NULL,
        file_type VARCHAR(50) DEFAULT 'image/jpeg',
        camera_id VARCHAR(50) DEFAULT 'cam_gate_1',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_evidence_event (event_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Create anpr_config table
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS anpr_config (
        camera_id VARCHAR(50) NOT NULL PRIMARY KEY,
        enabled TINYINT(1) DEFAULT 1,
        min_confidence DECIMAL(5,4) DEFAULT 0.8500,
        auto_confirm_threshold DECIMAL(5,4) DEFAULT 0.9500,
        capture_interval INT DEFAULT 5,
        region VARCHAR(50) DEFAULT 'IN',
        processing_mode VARCHAR(50) DEFAULT 'edge',
        api_key VARCHAR(255) NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Create report_field_configs table
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS report_field_configs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL DEFAULT 'default',
        report_type VARCHAR(50) NOT NULL DEFAULT 'weighment_report',
        s_no INT NOT NULL DEFAULT 0,
        field_key VARCHAR(100) NOT NULL,
        field_name VARCHAR(150) NOT NULL,
        is_selected TINYINT(1) NOT NULL DEFAULT 1,
        display_order INT NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_user_type_field (user_id, report_type, field_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Create weighbridge_sessions table
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS weighbridge_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(64) NOT NULL UNIQUE,
        transaction_no INT NULL,
        vehicle_reg_no VARCHAR(50) NOT NULL,
        party_name VARCHAR(150) NULL,
        firm_name VARCHAR(150) NULL,
        first_weight DECIMAL(10,2) NULL,
        first_weight_time DATETIME NULL,
        second_weight DECIMAL(10,2) NULL,
        second_weight_time DATETIME NULL,
        gross_weight DECIMAL(10,2) NULL,
        tare_weight DECIMAL(10,2) NULL,
        net_weight DECIMAL(10,2) NULL,
        material VARCHAR(150) NULL,
        product VARCHAR(150) NULL,
        rate DECIMAL(10,2) DEFAULT 0.00,
        moisture DECIMAL(10,2) DEFAULT 0.00,
        deduction DECIMAL(10,2) DEFAULT 0.00,
        charges DECIMAL(10,2) DEFAULT 0.00,
        less_weight DECIMAL(10,2) DEFAULT 0.00,
        final_weight DECIMAL(10,2) DEFAULT 0.00,
        mois_rate DECIMAL(10,2) DEFAULT 0.00,
        final_rate DECIMAL(10,2) DEFAULT 0.00,
        total_amount DECIMAL(12,2) DEFAULT 0.00,
        vehicle_type VARCHAR(100) NULL,
        bags_bales VARCHAR(50) NULL,
        agent VARCHAR(100) NULL,
        village VARCHAR(100) NULL,
        chess_no VARCHAR(50) NULL,
        chess_amount DECIMAL(10,2) DEFAULT 0.00,
        chess_name VARCHAR(100) NULL,
        location_name VARCHAR(150) NULL,
        cultivator_name VARCHAR(150) NULL,
        load_slip_no VARCHAR(50) NULL,
        father_name VARCHAR(150) NULL,
        mandal VARCHAR(100) NULL,
        bank_name VARCHAR(150) NULL,
        branch_name VARCHAR(150) NULL,
        ifsc_code VARCHAR(50) NULL,
        trader_name VARCHAR(150) NULL,
        alloted_mill VARCHAR(150) NULL,
        account_no VARCHAR(50) NULL,
        heap_no VARCHAR(50) NULL,
        mobile_no VARCHAR(50) NULL,
        image1 TEXT NULL,
        image2 TEXT NULL,
        image3 TEXT NULL,
        image4 TEXT NULL,
        udt DATETIME NULL,
        print_options JSON NULL,
        status VARCHAR(50) DEFAULT 'pending_1st_weight',
        operator_id VARCHAR(50) NULL,
        operator_name VARCHAR(100) NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_session_tx (transaction_no),
        INDEX idx_session_veh (vehicle_reg_no),
        INDEX idx_session_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Ensure all weighbridge_sessions columns exist
    const [existingWbCols] = await dbConnection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'weighbridge_sessions'
    `, [dbName]);
    const wbColSet = new Set(existingWbCols.map(c => c.COLUMN_NAME.toLowerCase()));

    const requiredWbCols = [
      { name: 'transaction_no', type: 'INT NULL' },
      { name: 'party_name', type: "VARCHAR(150) NULL" },
      { name: 'firm_name', type: "VARCHAR(150) NULL" },
      { name: 'first_weight', type: 'DECIMAL(10,2) NULL' },
      { name: 'first_weight_time', type: 'DATETIME NULL' },
      { name: 'second_weight', type: 'DECIMAL(10,2) NULL' },
      { name: 'second_weight_time', type: 'DATETIME NULL' },
      { name: 'material', type: 'VARCHAR(150) NULL' },
      { name: 'product', type: 'VARCHAR(150) NULL' },
      { name: 'rate', type: 'DECIMAL(10,2) DEFAULT 0.00' },
      { name: 'moisture', type: 'DECIMAL(10,2) DEFAULT 0.00' },
      { name: 'deduction', type: 'DECIMAL(10,2) DEFAULT 0.00' },
      { name: 'charges', type: 'DECIMAL(10,2) DEFAULT 0.00' },
      { name: 'less_weight', type: 'DECIMAL(10,2) DEFAULT 0.00' },
      { name: 'final_weight', type: 'DECIMAL(10,2) DEFAULT 0.00' },
      { name: 'mois_rate', type: 'DECIMAL(10,2) DEFAULT 0.00' },
      { name: 'final_rate', type: 'DECIMAL(10,2) DEFAULT 0.00' },
      { name: 'total_amount', type: 'DECIMAL(12,2) DEFAULT 0.00' },
      { name: 'vehicle_type', type: 'VARCHAR(100) NULL' },
      { name: 'bags_bales', type: 'VARCHAR(50) NULL' },
      { name: 'agent', type: 'VARCHAR(100) NULL' },
      { name: 'village', type: 'VARCHAR(100) NULL' },
      { name: 'chess_no', type: 'VARCHAR(50) NULL' },
      { name: 'chess_amount', type: 'DECIMAL(10,2) DEFAULT 0.00' },
      { name: 'chess_name', type: 'VARCHAR(100) NULL' },
      { name: 'location_name', type: 'VARCHAR(150) NULL' },
      { name: 'cultivator_name', type: 'VARCHAR(150) NULL' },
      { name: 'load_slip_no', type: 'VARCHAR(50) NULL' },
      { name: 'father_name', type: 'VARCHAR(150) NULL' },
      { name: 'mandal', type: 'VARCHAR(100) NULL' },
      { name: 'bank_name', type: 'VARCHAR(150) NULL' },
      { name: 'branch_name', type: 'VARCHAR(150) NULL' },
      { name: 'ifsc_code', type: 'VARCHAR(50) NULL' },
      { name: 'trader_name', type: 'VARCHAR(150) NULL' },
      { name: 'alloted_mill', type: 'VARCHAR(150) NULL' },
      { name: 'account_no', type: 'VARCHAR(50) NULL' },
      { name: 'heap_no', type: 'VARCHAR(50) NULL' },
      { name: 'mobile_no', type: 'VARCHAR(50) NULL' },
      { name: 'image1', type: 'TEXT NULL' },
      { name: 'image2', type: 'TEXT NULL' },
      { name: 'image3', type: 'TEXT NULL' },
      { name: 'image4', type: 'TEXT NULL' },
      { name: 'udt', type: 'DATETIME NULL' },
      { name: 'print_options', type: 'JSON NULL' }
    ];

    for (const col of requiredWbCols) {
      if (!wbColSet.has(col.name.toLowerCase())) {
        try {
          await dbConnection.query(`ALTER TABLE weighbridge_sessions ADD COLUMN \`${col.name}\` ${col.type}`);
        } catch (e) {
          console.warn(`Could not add column ${col.name} to weighbridge_sessions:`, e.message);
        }
      }
    }

    // Create weigh_slips table
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS weigh_slips (
        id INT AUTO_INCREMENT PRIMARY KEY,
        slip_number VARCHAR(64) DEFAULT NULL,
        session_id VARCHAR(64) DEFAULT NULL,
        transaction_no INT NOT NULL,
        vehicle_reg_no VARCHAR(50) DEFAULT '',
        vehicle_no VARCHAR(50) NOT NULL,
        party_name VARCHAR(255) DEFAULT '',
        firm_name VARCHAR(255) DEFAULT '',
        first_weight DECIMAL(10,2) DEFAULT NULL,
        first_weight_date DATE DEFAULT NULL,
        first_weight_time DATETIME DEFAULT NULL,
        second_weight DECIMAL(10,2) DEFAULT NULL,
        second_weight_date DATE DEFAULT NULL,
        second_weight_time DATETIME DEFAULT NULL,
        tare_weight DECIMAL(10,2) DEFAULT NULL,
        gross_weight DECIMAL(10,2) DEFAULT NULL,
        net_weight DECIMAL(10,2) DEFAULT NULL,
        nett_weight DECIMAL(10,2) DEFAULT NULL,
        rate DECIMAL(10,2) DEFAULT 0,
        moisture DECIMAL(5,2) DEFAULT 0,
        deduction DECIMAL(10,2) DEFAULT 0,
        charges DECIMAL(10,2) DEFAULT 0,
        vehicle_type VARCHAR(100) DEFAULT '',
        bags_bales VARCHAR(100) DEFAULT '',
        agent VARCHAR(100) DEFAULT '',
        village VARCHAR(100) DEFAULT '',
        chess_no VARCHAR(50) DEFAULT '',
        chess_amount DECIMAL(10,2) DEFAULT 0,
        chess_name VARCHAR(100) DEFAULT '',
        final_rate DECIMAL(10,2) DEFAULT 0,
        total_amount DECIMAL(12,2) DEFAULT 0,
        print_options JSON DEFAULT NULL,
        company_name VARCHAR(255) DEFAULT '',
        company_address TEXT DEFAULT NULL,
        phone_no VARCHAR(50) DEFAULT '',
        load_slip_no VARCHAR(100) DEFAULT '',
        cultivator_name VARCHAR(150) DEFAULT '',
        father_name VARCHAR(150) DEFAULT '',
        location_name VARCHAR(150) DEFAULT '',
        mobile_no VARCHAR(50) DEFAULT '',
        material VARCHAR(150) DEFAULT '',
        product VARCHAR(150) DEFAULT '',
        destination VARCHAR(150) DEFAULT '',
        driver_name VARCHAR(150) DEFAULT '',
        operator_name VARCHAR(100) DEFAULT '',
        evidence JSON DEFAULT NULL,
        admin_name VARCHAR(100) DEFAULT '',
        status VARCHAR(50) DEFAULT 'completed',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_slip_tx (transaction_no),
        INDEX idx_slip_veh (vehicle_no)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Ensure all weigh_slips columns exist
    const [existingSlipCols] = await dbConnection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'weigh_slips'
    `, [dbName]);
    const slipColSet = new Set(existingSlipCols.map(c => c.COLUMN_NAME.toLowerCase()));

    const requiredSlipCols = [
      { name: 'transaction_no', type: 'INT DEFAULT 0' },
      { name: 'party_name', type: "VARCHAR(255) DEFAULT ''" },
      { name: 'firm_name', type: "VARCHAR(255) DEFAULT ''" },
      { name: 'first_weight', type: 'DECIMAL(10,2) DEFAULT NULL' },
      { name: 'first_weight_time', type: 'DATETIME DEFAULT NULL' },
      { name: 'second_weight', type: 'DECIMAL(10,2) DEFAULT NULL' },
      { name: 'second_weight_time', type: 'DATETIME DEFAULT NULL' },
      { name: 'rate', type: 'DECIMAL(10,2) DEFAULT 0' },
      { name: 'moisture', type: 'DECIMAL(5,2) DEFAULT 0' },
      { name: 'deduction', type: 'DECIMAL(10,2) DEFAULT 0' },
      { name: 'charges', type: 'DECIMAL(10,2) DEFAULT 0' },
      { name: 'vehicle_type', type: "VARCHAR(100) DEFAULT ''" },
      { name: 'bags_bales', type: "VARCHAR(100) DEFAULT ''" },
      { name: 'agent', type: "VARCHAR(100) DEFAULT ''" },
      { name: 'village', type: "VARCHAR(100) DEFAULT ''" },
      { name: 'chess_no', type: "VARCHAR(50) DEFAULT ''" },
      { name: 'chess_amount', type: 'DECIMAL(10,2) DEFAULT 0' },
      { name: 'chess_name', type: "VARCHAR(100) DEFAULT ''" },
      { name: 'final_rate', type: 'DECIMAL(10,2) DEFAULT 0' },
      { name: 'total_amount', type: 'DECIMAL(12,2) DEFAULT 0' },
      { name: 'print_options', type: 'JSON DEFAULT NULL' },
      { name: 'company_name', type: "VARCHAR(255) DEFAULT ''" },
      { name: 'company_address', type: "TEXT DEFAULT NULL" },
      { name: 'phone_no', type: "VARCHAR(50) DEFAULT ''" },
      { name: 'load_slip_no', type: "VARCHAR(100) DEFAULT ''" },
      { name: 'vehicle_no', type: "VARCHAR(50) DEFAULT ''" },
      { name: 'cultivator_name', type: "VARCHAR(150) DEFAULT ''" },
      { name: 'location_name', type: "VARCHAR(150) DEFAULT ''" },
      { name: 'father_name', type: "VARCHAR(150) DEFAULT ''" },
      { name: 'product', type: "VARCHAR(150) DEFAULT ''" },
      { name: 'mobile_no', type: "VARCHAR(50) DEFAULT ''" },
      { name: 'status', type: "VARCHAR(50) DEFAULT 'completed'" },
      { name: 'first_weight_date', type: "DATE DEFAULT NULL" },
      { name: 'second_weight_date', type: "DATE DEFAULT NULL" },
      { name: 'nett_weight', type: "DECIMAL(10,2) DEFAULT NULL" },
      { name: 'admin_name', type: "VARCHAR(100) DEFAULT ''" },
      { name: 'updated_at', type: 'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' }
    ];

    for (const col of requiredSlipCols) {
      if (!slipColSet.has(col.name.toLowerCase())) {
        try {
          await dbConnection.query(`ALTER TABLE weigh_slips ADD COLUMN \`${col.name}\` ${col.type}`);
        } catch (e) {}
      }
    }

    // Auto-backfill only missing weighbridge_sessions into weigh_slips (do not touch existing rows)
    try {
      await dbConnection.query(`
        INSERT IGNORE INTO weigh_slips (
          slip_number, session_id, transaction_no, vehicle_reg_no, party_name, firm_name,
          date_time, first_weight, first_weight_time, second_weight, second_weight_time,
          tare_weight, gross_weight, net_weight, material, rate, moisture, deduction,
          charges, vehicle_type, bags_bales, agent, village, chess_no, chess_amount,
          chess_name, final_rate, total_amount, print_options, driver_name, destination,
          operator_name, evidence, load_slip_no, vehicle_no, cultivator_name, location_name,
          father_name, mobile_no, status, first_weight_date, second_weight_date, nett_weight,
          admin_name, product, created_at
        )
        SELECT
          CONCAT('WS-2026-', LPAD(ws.transaction_no, 4, '0')),
          ws.session_id, ws.transaction_no, ws.vehicle_reg_no, ws.party_name, ws.firm_name,
          COALESCE(ws.timestamp, NOW()), ws.first_weight, ws.first_weight_time, ws.second_weight, ws.second_weight_time,
          ws.tare_weight, ws.gross_weight, ws.net_weight, ws.material, ws.rate, ws.moisture, ws.deduction,
          ws.charges, ws.vehicle_type, ws.bags_bales, ws.agent, ws.village, ws.chess_no, ws.chess_amount,
          ws.chess_name, ws.final_rate, ws.total_amount, ws.print_options, ws.driver_name, ws.destination,
          ws.operator_name, ws.evidence, ws.load_slip_no, ws.vehicle_reg_no, ws.cultivator_name, ws.location_name,
          ws.father_name, ws.mobile_no, ws.status,
          DATE(ws.first_weight_time), DATE(ws.second_weight_time), ws.net_weight,
          ws.operator_name, ws.material, ws.created_at
        FROM weighbridge_sessions ws
        WHERE ws.transaction_no IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM weigh_slips s
            WHERE s.slip_number = CONCAT('WS-2026-', LPAD(ws.transaction_no, 4, '0'))
               OR s.session_id = ws.session_id
          )
      `);
    } catch (syncErr) {
      console.warn('Auto-backfill weigh_slips warning:', syncErr.message);
    }

    // Ensure sync metadata, execution logs, and tombstone tables exist
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS edge_sync_tracking (
        table_name VARCHAR(64) PRIMARY KEY,
        last_synced_at DATETIME NOT NULL DEFAULT '2000-01-01 00:00:00',
        last_synced_pk VARCHAR(128) NOT NULL DEFAULT '',
        total_synced INT NOT NULL DEFAULT 0,
        pending_count INT NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'idle',
        last_error TEXT,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [trackingCols] = await dbConnection.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'edge_sync_tracking'`,
      [dbName]
    );
    const trackingColSet = new Set(trackingCols.map((c) => c.COLUMN_NAME.toLowerCase()));
    if (!trackingColSet.has('last_synced_pk')) {
      await dbConnection.query(
        `ALTER TABLE edge_sync_tracking ADD COLUMN last_synced_pk VARCHAR(128) NOT NULL DEFAULT '' AFTER last_synced_at`
      );
    }

    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS sync_logs (
        sync_id VARCHAR(64) PRIMARY KEY,
        started_at DATETIME NOT NULL,
        completed_at DATETIME NULL,
        source_db VARCHAR(128) NOT NULL,
        destination_db VARCHAR(128) NOT NULL,
        channel VARCHAR(32) NOT NULL DEFAULT 'none',
        total_checked INT NOT NULL DEFAULT 0,
        inserted_count INT NOT NULL DEFAULT 0,
        updated_count INT NOT NULL DEFAULT 0,
        deleted_count INT NOT NULL DEFAULT 0,
        unchanged_count INT NOT NULL DEFAULT 0,
        failed_count INT NOT NULL DEFAULT 0,
        status VARCHAR(32) NOT NULL DEFAULT 'running',
        error_details TEXT NULL,
        table_summary JSON NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sync_logs_started (started_at),
        INDEX idx_sync_logs_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS sync_tombstones (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        table_name VARCHAR(64) NOT NULL,
        pk_column VARCHAR(64) NOT NULL,
        pk_value VARCHAR(128) NOT NULL,
        deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        synced_at DATETIME NULL,
        sync_status VARCHAR(20) NOT NULL DEFAULT 'pending',
        error_message TEXT NULL,
        INDEX idx_tombstone_pending (sync_status, deleted_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    
    console.log('✅ Database tables initialized successfully!');
    dbConnection.release();
    return true;
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    return false;
  }
}

/**
 * Records a soft-tombstone deletion event so background synchronization
 * can safely propagate eligible hard-deletes from LOCAL -> SERVER.
 */
async function recordSyncTombstone(tableName, pkColumn, pkValue) {
  if (!tableName || !pkColumn || pkValue === undefined || pkValue === null) return;
  try {
    await pool.query(
      `INSERT INTO sync_tombstones (table_name, pk_column, pk_value, deleted_at, sync_status)
       VALUES (?, ?, ?, NOW(), 'pending')`,
      [tableName, pkColumn, String(pkValue)]
    );
  } catch (err) {
    console.warn(`[Sync Tombstone] Could not record delete for ${tableName}.${pkColumn}=${pkValue}:`, err.message);
  }
}

export { pool, testConnection, initializeDatabase, recordSyncTombstone };
