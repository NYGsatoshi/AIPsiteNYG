import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { AipThemeToggleComponent } from './shared/theme/aip-theme-toggle/aip-theme-toggle.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, AipThemeToggleComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class AppComponent {}
