import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody } from '@/components/ui';
import {
  StepWelcome,
  StepTwilio,
  StepEmail,
  StepAI,
  StepContacts,
  StepDone,
} from '@/wizard/steps';

const STEPS = ['Welcome', 'Twilio', 'Email', 'AI', 'Contacts', 'Done'] as const;

/**
 * 6-step onboarding wizard. Reachable at /setup. Each step writes real config
 * to the server (integrations, email account, contacts) and tests it before
 * advancing. The final step shows a pairing QR.
 */
export function Wizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const skip = () => next();
  const finish = () => navigate('/', { replace: true });

  return (
    <div className="flex min-h-full items-center justify-center px-6 py-10">
      <div className="w-full max-w-md">
        {/* Progress dots */}
        <div className="mb-5 flex items-center justify-center gap-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`h-2 w-2 rounded-full transition-colors ${
                  i < step ? 'bg-phos' : i === step ? 'bg-phos ring-2 ring-phos/30' : 'bg-line-strong'
                }`}
                title={label}
              />
            </div>
          ))}
        </div>
        <p className="mb-3 text-center text-xs text-ink-faint">
          Step {step + 1} of {STEPS.length} · {STEPS[step]}
        </p>

        <Card>
          <CardBody className="pt-6">
            {step === 0 && <StepWelcome onNext={next} />}
            {step === 1 && <StepTwilio onNext={next} onSkip={skip} />}
            {step === 2 && <StepEmail onNext={next} onSkip={skip} />}
            {step === 3 && <StepAI onNext={next} onSkip={skip} />}
            {step === 4 && <StepContacts onNext={next} onSkip={skip} />}
            {step === 5 && <StepDone onFinish={finish} />}
          </CardBody>
        </Card>

        {step > 0 && step < 5 && (
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="mt-3 w-full text-center text-xs text-ink-faint hover:text-ink-muted"
          >
            ← back
          </button>
        )}
      </div>
    </div>
  );
}
