import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';

import { AppFieldErrorComponent } from '../../../shared/form/app-field-error/app-field-error.component';
import { PasswordChangeResult, PasswordChangeSubmit } from '../account.types';

@Component({
  selector: 'app-password-panel',
  standalone: true,
  imports: [ReactiveFormsModule, AppFieldErrorComponent],
  templateUrl: './password-panel.component.html',
  styleUrl: './password-panel.component.scss'
})
export class PasswordPanelComponent {
  @Input() result: PasswordChangeResult | null = null;
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
    return control.touched && control.hasError('required') ? ['現在のパスワードを入力してください。'] : [];
  }

  get newPasswordMessages(): readonly string[] {
    const control = this.form.controls.newPassword;
    return control.touched && control.hasError('required') ? ['新しいパスワードを入力してください。'] : [];
  }

  get confirmNewPasswordMessages(): readonly string[] {
    const control = this.form.controls.confirmNewPassword;
    if (!control.touched && !this.form.touched) {
      return [];
    }

    if (control.hasError('required')) {
      return ['確認用パスワードを入力してください。'];
    }

    return this.form.hasError('passwordMismatch') ? ['新しいパスワードが一致しません。'] : [];
  }

  submit(): void {
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
