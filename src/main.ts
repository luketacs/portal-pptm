import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, withRouterConfig } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { ErrorHandler, LOCALE_ID } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt';

import { AppComponent } from './app/app.component';
import { APP_ROUTES } from './app/app.routes';
import { GlobalErrorHandler } from './app/global-error-handler';

registerLocaleData(localePt, 'pt-BR');

// Remove APP_INITIALIZER - let the component handle auth initialization
// This prevents the app from blocking on slow auth checks

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(
      APP_ROUTES,
      withRouterConfig({
        onSameUrlNavigation: 'reload',
        urlUpdateStrategy: 'eager'
      })
    ),
    provideHttpClient(),
    { provide: LOCALE_ID, useValue: 'pt-BR' },
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
  ]
});
