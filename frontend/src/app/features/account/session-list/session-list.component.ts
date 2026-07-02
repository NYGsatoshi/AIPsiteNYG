import { Component, Input } from '@angular/core';

import { AccountSessionViewModel } from '../account.types';

@Component({
  selector: 'app-session-list',
  standalone: true,
  templateUrl: './session-list.component.html',
  styleUrl: './session-list.component.scss'
})
export class SessionListComponent {
  @Input({ required: true }) sessions!: readonly AccountSessionViewModel[];
}
