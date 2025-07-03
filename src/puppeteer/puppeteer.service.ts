import { Injectable } from '@nestjs/common';
import * as puppeteer from 'puppeteer';

@Injectable()
export class PuppeteerService {
   async convertHtmlToPdf(htmlContent: string, outputPath?: string, returnBuffer: boolean = false): Promise<Buffer> {
       const browser = await puppeteer.launch({
           headless: 'new' as any
       });
       
       try {
           const page = await browser.newPage();
           await page.setContent(htmlContent, {
               waitUntil: 'networkidle0'
           });
           
           const pdfBuffer = await page.pdf({
               path: returnBuffer ? undefined : outputPath,
               format: 'A4',
               printBackground: true,
               margin: {
                   top: '20mm',
                   right: '15mm',
                   bottom: '20mm',
                   left: '15mm'
               }
           });
           
           return Buffer.from(pdfBuffer);
       } finally {
           await browser.close();
       }
   }
}