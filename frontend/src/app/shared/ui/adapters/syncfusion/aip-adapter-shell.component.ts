import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { AipAdapterPresentation, AipAdapterState, AipComplexAdapterName } from '../../contracts/aip-complex-adapter.contracts';

@Component({
  selector: 'aip-adapter-shell',
  standalone: true,
  template: `
    <section
      class="aip-adapter-shell"
      [attr.aria-label]="ariaLabel"
      [attr.data-aip-adapter]="adapter"
      [attr.data-aip-presentation]="presentation"
      [attr.data-aip-state]="state"
      [attr.data-testid]="'aip-' + adapter + '-adapter'">
      <span class="aip-adapter-shell__label">{{ label }}</span>
      <span class="aip-adapter-shell__state" aria-live="polite">{{ stateLabel }}</span>
      <ng-content />
    </section>
  `,
  styleUrl: './aip-adapter-shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AipAdapterShellComponent {
  @Input({ required: true }) adapter!: AipComplexAdapterName;
  @Input({ required: true }) ariaLabel!: string;
  @Input() label = 'AIPsite adapter fallback';
  @Input() presentation: AipAdapterPresentation = 'desktop';
  @Input() state: AipAdapterState = 'ready';

  get stateLabel(): string {
    return this.state.replace('-', ' ');
  }
}
