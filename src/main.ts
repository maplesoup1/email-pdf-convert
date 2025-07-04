import { config } from 'dotenv';
config({ path: '.env.local' });

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
 const app = await NestFactory.create(AppModule);
 
 // CORS configuration
 app.enableCors();
 
 // Global prefix for all routes
 app.setGlobalPrefix('api');
 
 // Body parser configuration (NestJS handles this automatically)
 
 // Create required directories
 const downloadsDir = path.join(__dirname, '/Users/xtom/222');
 const attachmentsDir = path.join(downloadsDir, 'attachments');

 if (!fs.existsSync(downloadsDir)) {
   fs.mkdirSync(downloadsDir, { recursive: true });
 }
 if (!fs.existsSync(attachmentsDir)) {
   fs.mkdirSync(attachmentsDir, { recursive: true });
 }

 const PORT = process.env.PORT || 3000;

 await app.listen(PORT);
 
 console.log(`🚀 Server running at http://localhost:${PORT}`);
 console.log(`📚 API Documentation: http://localhost:${PORT}/api`);
 console.log(`🎯 Available endpoints:`);
 console.log(`   Auth: http://localhost:${PORT}/api/auth`);
 console.log(`   Emails: http://localhost:${PORT}/api/emails`);
 console.log(`   Attachments: http://localhost:${PORT}/api/attachments`);
 console.log(`   Demerge: http://localhost:${PORT}/api/demerge`);
 console.log(`   Settings: http://localhost:${PORT}/api/download`);
}

bootstrap();