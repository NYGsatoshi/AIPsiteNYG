import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize, take } from 'rxjs';

import { AuthSessionFacade } from '../../../core/auth/auth-session.facade';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.scss'
})
export class LoginPageComponent {
  private readonly authSession = inject(AuthSessionFacade);
  private readonly router = inject(Router);

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email]
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required]
    })
  });

  submit(): void {
    this.errorMessage.set(null);
    if (this.form.invalid || this.isSubmitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const { email, password } = this.form.getRawValue();
    this.isSubmitting.set(true);
    this.authSession
      .login(email.trim(), password)
      .pipe(
        take(1),
        finalize(() => this.isSubmitting.set(false))
      )
      .subscribe({
        next: () => {
          void this.router.navigateByUrl('/workspaces');
        },
        error: () => {
          this.errorMessage.set('メールアドレスまたはパスワードを確認してください。');
        }
      });
  }
}
