import { Injectable } from '@nestjs/common';

interface EmailData {
   subject: string;
   from: string;
   to: string;
   date: string;
   body: string;
   isHtml: boolean;
}

interface Attachment {
   filename: string;
   mimeType: string;
   size: number;
   isPdf: boolean;
}

@Injectable()
export class HtmlService {
   createEmailHTML(emailData: EmailData, attachments: Attachment[] = []): string {
       const { subject, from, to, date, body, isHtml } = emailData;
       
       const emailBody = isHtml ? body : `<pre style="white-space: pre-wrap; font-family: Arial, sans-serif;">${body.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
       
       let attachmentHTML = '';
       if (attachments && attachments.length > 0) {
           attachmentHTML = `
           <div class="attachments-section">
               <h3>Attachment information:</h3>
               <ul>
                   ${attachments.map(att => `
                       <li>
                           <strong>${att.filename}</strong> 
                           (${att.mimeType}, ${(att.size / 1024).toFixed(2)} KB)
                           ${att.isPdf ? '<span class="pdf-badge">PDF file</span>' : ''}
                       </li>
                   `).join('')}
               </ul>
           </div>
           `;
       }
       
       return `
       <!DOCTYPE html>
       <html lang="zh-CN">
       <head>
           <meta charset="UTF-8">
           <meta name="viewport" content="width=device-width, initial-scale=1.0">
           <title>${subject}</title>
           <style>
               body {
                   font-family: 'Microsoft YaHei', Arial, sans-serif;
                   max-width: 800px;
                   margin: 0 auto;
                   padding: 20px;
                   line-height: 1.6;
                   color: #333;
               }
               .email-header {
                   background-color: #f5f5f5;
                   padding: 20px;
                   border-radius: 8px;
                   margin-bottom: 20px;
                   border-left: 4px solid #4285f4;
               }
               .email-meta {
                   margin: 8px 0;
                   font-size: 14px;
               }
               .email-meta strong {
                   color: #1a73e8;
                   min-width: 60px;
                   display: inline-block;
               }
               .email-subject {
                   font-size: 24px;
                   font-weight: bold;
                   color: #202124;
                   margin-bottom: 15px;
               }
               .attachments-section {
                   background-color: #f8f9fa;
                   padding: 15px;
                   border-radius: 8px;
                   margin: 15px 0;
                   border: 1px solid #e0e0e0;
               }
               .attachments-section h3 {
                   margin-top: 0;
                   color: #1a73e8;
               }
               .pdf-badge {
                   background-color: #dc3545;
                   color: white;
                   padding: 2px 6px;
                   border-radius: 3px;
                   font-size: 12px;
                   margin-left: 10px;
               }
               .email-body {
                   background-color: #fff;
                   padding: 20px;
                   border-radius: 8px;
                   border: 1px solid #e0e0e0;
                   min-height: 200px;
               }
               .generated-info {
                   margin-top: 30px;
                   padding: 10px;
                   background-color: #f8f9fa;
                   border-radius: 4px;
                   font-size: 12px;
                   color: #666;
                   text-align: center;
               }
           </style>
       </head>
       <body>
           <div class="email-header">
               <div class="email-subject">${subject}</div>
               <div class="email-meta"><strong>From:</strong> ${from}</div>
               <div class="email-meta"><strong>To:</strong> ${to}</div>
               <div class="email-meta"><strong>Date:</strong> ${date}</div>
               ${attachmentHTML}
           </div>
           
           <div class="email-body">
               ${emailBody}
           </div>
       </body>
       </html>
       `;
   }
}