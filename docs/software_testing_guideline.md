# Software Testing Guideline

A three-phase framework for planning, designing, and executing software tests on a development project. Based on IEEE 829 and the SDLC testing approach in Everett (2007), _Software Testing: Testing Across the Entire Software Development Lifecycle_.

---

## Phase 1: Testing Strategy

Define the high-level approach before any test cases are written.

### Required elements

1. **Development risk analysis**
   - Identify the magnitude of development risk that is reducible by testing.
   - Identify the sources of that risk (technical, business, integration, performance, security, etc.).

2. **Test completion criterion**
   - Define a concrete rule for when testing is "done."
   - This criterion drives prioritization and stop conditions.

3. **Test management**
   - Define how testing will be managed: ownership, roles, escalation, sign-off.
   - Treat testing as a budgeted activity proportional to the dollar value of the business risk.

4. **Timing for ROI**
   - Decide when testing happens across the SDLC to maximize client return on investment.
   - Earlier defect detection lowers cost of failure.

5. **Cost of failure estimate**
   - Quantify what a defect in production would cost (dollars, reputation, downtime, compliance).

6. **Risk reduction tactics**
   - How positive and negative testing will be combined.
   - Mechanism for prioritizing risks (e.g., severity × likelihood matrix).
   - Use statistical analysis of defect arrival patterns to forecast test completion.
   - Customer usage analysis: how real users will exercise the system, which then shapes the strategy.

7. **Selected testing types** (pick what fits the project)
   - Static testing (code review, doc review, no execution)
   - White-box testing (structural, knows internals)
   - Black-box testing (functional, no knowledge of internals)
   - Performance testing (speed, load, stress)

---

## Phase 2: Test Plan (IEEE 829 format)

Translate the strategy into a written plan with at least 50 test cases. Split into two parts.

### Part A: Overall test plan (sections 1 to 7)

1. **System under test**: brief description of the applications and systems being tested.
2. **Testing objectives**: tied to business needs and perceived business risk, with rationale.
3. **Scope and limitations**: what is in, what is out, known constraints.
4. **Sources of business expertise**: who provides domain input (client, SMEs).
5. **Sources of development expertise**: who provides technical input (devs, architects).
6. **Sources of test data**: where realistic data comes from (synthetic, anonymized production, fixtures).
7. **Test environment requirements**: hardware, software, network, access, and how the environments are managed.

### Part B: Detailed test execution instructions (sections 8 to 10)

8. **Testing details per development phase**, for each phase document:
   - Development phase (unit, integration, system, UAT, etc.)
   - Entry criteria: how to know testing can start
   - Exit criteria: how to know testing is finished
   - Draft test case list: ID, title, brief description
   - Test case writing schedule
   - Test case execution schedule
   - Test case results analysis and reporting schedule

9. **Overall testing schedule**: the master schedule that composites all per-phase schedules into one timeline.

10. **Test case set**: minimum 50 test cases covering the objectives.

---

## Phase 3: Test Execution

Run the plan and document the outcomes.

### 1. Test environment setup

- **No localhost.** The application must run in an isolated environment that exhibits production behaviour while being observed and measured.
- Choose one:
  - **Docker-based**: application containerized and deployed on a Docker network.
  - **Virtual Machine**: application deployed to a VM (VMware, VirtualBox, or a cloud instance).

### 2. Execution steps

- **Functional testing**: apply the appropriate functional testing techniques to the use cases from the test plan. Goal: validate behaviour against documented requirements.
- **Performance testing**: measure speed against the documented business need for speed.
- **Automated testing**: use automated tools where they reduce effort or improve coverage.

### 3. Documentation

- **Daily testing outcome log**: record results per day of testing.
- **Defect Tracking Spreadsheet**:
  - Log every defect.
  - Assign a severity code to each defect so urgent fixes are obvious.
  - Document the standardized way to identify the code in which each defect correction was applied (commit, branch, file, function).
- **Test case execution progress tracking**: compute the ratio of passed to total attempted test cases to estimate how defect-free the software is.
- **Defect backlog**: create only when not all defects can be fixed. Track the gap between detected defects and corrected defects.

---

## Working principles (apply across all three phases)

- Testing objectives are always tied to business risk, not technical preference.
- Plan before testing. Unplanned testing wastes the budget that pays for risk reduction.
- Treat the client or domain expert as a first-class testing participant.
- Track defect arrival rate over time. A flattening curve is evidence for completion.
- Prefer cheap early defect detection (static, unit) over expensive late detection (UAT, production).
- Every test case has: ID, title, description, preconditions, steps, expected result, actual result, pass/fail, severity (if failed).
- Every defect has: ID, description, severity, steps to reproduce, environment, status, fix reference.
