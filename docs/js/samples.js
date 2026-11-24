// Fictional sample letters (names, agencies and numbers are made up). Dates are relative to today
// so the demo always shows an upcoming deadline.
const fmt = (d) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

export function samples() {
  return [
    {
      id: 'health',
      label: 'Health coverage renewal',
      text: `LAKEVIEW COUNTY DEPARTMENT OF HEALTH SERVICES
SAMPLE LETTER - FICTIONAL

Date of notice: ${fmt(plus(-3))}
Case Number: HC-2048-7731

IMPORTANT: Renew your Medicaid coverage

Dear Maria Lopez,

It is time to complete your annual redetermination of eligibility for Medicaid. Pursuant to state and federal rules, we must verify your household income and household size to determine whether you continue to qualify.

You must return the enclosed renewal form and verification of income (such as your last 30 days of pay stubs) no later than ${fmt(plus(12))}. You can return it by mail in the enclosed envelope, online at benefits.lakeview.gov, or by calling 555-201-4400.

If we do not receive your completed renewal form by the due date, your Medicaid coverage will be terminated effective ${fmt(plus(30))}. This is an adverse action. You have the right to request a fair hearing if you disagree with any decision.

If you need help, call us at 555-201-4400 (TTY 711), Monday to Friday, 8 am to 5 pm.`,
    },
    {
      id: 'housing',
      label: 'Landlord notice',
      text: `RIVERSTONE PROPERTY MANAGEMENT
SAMPLE LETTER - FICTIONAL

${fmt(plus(-1))}

To: James Carter, Tenant
Premises: 412 Elm Street, Unit 3B

NOTICE OF RENT INCREASE AND NOTICE TO PAY

Please be advised that, pursuant to Section 4 of your lease, the monthly rent for the premises will increase from $1,250.00 to $1,395.00 effective ${fmt(plus(45))}.

Our records also show a past due balance of $310.00 in arrears for late fees and utilities. You must remit the full balance on or before ${fmt(plus(6))} or contact our office to set up a payment arrangement. Failure to pay may result in further legal action, including a notice to quit.

Payments may be made at riverstonepm.com or by calling 555-318-2290. Reference number: RS-88412.

Sincerely,
Riverstone Property Management`,
    },
    {
      id: 'utility',
      label: 'Utility shut-off warning',
      text: `NORTHGATE ELECTRIC & GAS
SAMPLE LETTER - FICTIONAL
FINAL NOTICE

Account Number: 4471-09982-3
Notice date: ${fmt(plus(-2))}

Your account has a past due balance of $186.42. To avoid disconnection of your electric service, please pay the past due amount by ${fmt(plus(4))}.

If payment is not received, your service will be shut off on or after ${fmt(plus(5))}, and a reconnection fee of $45.00 will apply.

You may qualify for a payment arrangement or energy assistance. Call 555-640-7700 or visit northgate-energy.com/help. If someone in your home depends on medical equipment, call us right away.`,
    },
  ];
}
