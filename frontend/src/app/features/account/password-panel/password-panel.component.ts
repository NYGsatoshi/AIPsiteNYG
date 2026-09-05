import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';

import { I18nService } from '../../../core/i18n/i18n.service';
import { AppFieldErrorComponent } from '../../../shared/form/app-field-error/app-field-error.component';
import { PasswordChangeResult, PasswordChangeSubmit } from '../account.types';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-password-panel',
  standalone: true,
  imports: [ReactiveFormsModule, AppFieldErrorComponent],
  templateUrl: './password-panel.component.html',
  styleUrl: './password-panel.component.scss',
})
export class PasswordPanelComponent implements OnChanges {
  readonly i18n = inject(I18nService);
  @Input() result: PasswordChangeResult | null = null;
  @Input() pending = false;
  @Output() readonly passwordChange = new EventEmitter<PasswordChangeSubmit>();

  readonly form = new FormBuilder().nonNullable.group(
    {
      currentPassword: ['', [Validators.required]],
      newPassword: ['', [Validators.required]],
      confirmNewPassword: ['', [Validators.required]]
    },
    { validators: [confirmNewPasswordMatchesValidator()] }
  );

  get currentPasswordMessages(): readonly string[] {
    const control = this.form.controls.currentPassword;
    return control.touched && control.hasError('required') ? [this.i18n.translate('password.currentRequired')] : [];
  }

  get newPasswordMessages(): readonly string[] {
    const control = this.form.controls.newPassword;
    return control.touched && control.hasError('required') ? [this.i18n.translate('password.newRequired')] : [];
  }

  get confirmNewPasswordMessages(): readonly string[] {
    const control = this.form.controls.confirmNewPassword;
    if (!control.touched && !this.form.touched) {
      return [];
    }

    if (control.hasError('required')) {
      return [this.i18n.translate('password.confirmRequired')];
    }

    return this.form.hasError('passwordMismatch') ? [this.i18n.translate('password.mismatch')] : [];
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['result']?.currentValue === 'success') {
      this.form.reset();
    }
  }

  submit(): void {
    if (this.pending) {
      return;
    }

    this.form.markAllAsTouched();
    if (this.form.invalid) {
      return;
    }

    this.passwordChange.emit(this.form.getRawValue());
  }
}

function confirmNewPasswordMatchesValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const newPassword = control.get('newPassword')?.value;
    const confirmNewPassword = control.get('confirmNewPassword')?.value;
    return newPassword && confirmNewPassword && newPassword !== confirmNewPassword ? { passwordMismatch: true } : null;
  };
}
