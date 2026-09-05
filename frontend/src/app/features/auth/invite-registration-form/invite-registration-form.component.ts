import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';

import { AppFieldErrorComponent } from '../../../shared/form/app-field-error/app-field-error.component';
import { InviteRegistrationFormSubmit } from '../invite-registration.types';

@Component({
  selector: 'app-invite-registration-form',
  standalone: true,
  imports: [ReactiveFormsModule, AppFieldErrorComponent],
  templateUrl: './invite-registration-form.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './invite-registration-form.component.scss',
})
export class InviteRegistrationFormComponent {
  @Input({ required: true }) email!: string;
  @Input() submitDisabled = false;
  @Output() readonly registerInvite = new EventEmitter<InviteRegistrationFormSubmit>();

  readonly form = new FormBuilder().nonNullable.group(
    {
      displayName: ['', [Validators.required]],
      password: ['', [Validators.required]],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: [confirmPasswordMatchesValidator()] },
  );

  get displayNameMessages(): readonly string[] {
    const control = this.form.controls.displayName;
    return control.touched && control.hasError('required') ? ['Display name is required.'] : [];
  }

  get passwordMessages(): readonly string[] {
    const control = this.form.controls.password;
    return control.touched && control.hasError('required') ? ['Password is required.'] : [];
  }

  get confirmPasswordMessages(): readonly string[] {
    const control = this.form.controls.confirmPassword;
    if (!control.touched && !this.form.touched) {
      return [];
    }

    if (control.hasError('required')) {
      return ['Confirm your password.'];
    }

    return this.form.hasError('passwordMismatch') ? ['Passwords must match.'] : [];
  }

  get canSubmit(): boolean {
    return !this.submitDisabled && this.form.valid;
  }

  submit(): void {
    this.form.markAllAsTouched();
    if (!this.canSubmit) {
      return;
    }

    const value = this.form.getRawValue();
    this.registerInvite.emit({
      displayName: value.displayName.trim(),
      password: value.password,
    });
  }
}

function confirmPasswordMatchesValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const password = control.get('password')?.value;
    const confirmPassword = control.get('confirmPassword')?.value;
    return password && confirmPassword && password !== confirmPassword
      ? { passwordMismatch: true }
      : null;
  };
}
