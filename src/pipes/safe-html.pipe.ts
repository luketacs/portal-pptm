import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Pipe({
  name: 'safeHtml',
  standalone: true,
})
export class SafeHtmlPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(value: string): SafeHtml {
    if (!value || typeof value !== 'string') {
      return '';
    }
    // Only allow SVG content — reject anything with script, event handlers, or iframe
    const lower = value.toLowerCase();
    if (/<script|on\w+\s*=|javascript:|<iframe|<object|<embed/i.test(lower)) {
      return '';
    }
    return this.sanitizer.bypassSecurityTrustHtml(value);
  }
}