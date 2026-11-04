
----------------------------
-- Add any default subprograms here
-- For example, to drive a gripper as a program call:
-- def Gripper_Open():
--   ...
-- end
--
-- Example to drive a spray gun:
function SprayOn(value)
    -- use the value as an output:
    DO_SPRAY = 5
    if value == 0 then
      setStandardDigitalOutput(DO_SPRAY, false)
    else
      setStandardDigitalOutput(DO_SPRAY, true)
    end
end

-- Example to synchronize 2
function Synchronize()
    -- Use the following digital output to signal the state of the robot:
    DO_SYNC = 1

    -- Use the following digital input to get the state of another robot:
    DI_SYNC = 1

    if getStandardDigitalOutput(DO_SYNC) == getStandardDigitalInput(DI_SYNC) then
        -- If the states are the same, toggle the output and sleep for 0.1 seconds
        setStandardDigitalOutput(DO_SYNC, not getStandardDigitalOutput(DI_SYNC))
        sleep(0.1)

        -- Create a function to wait in a loop
        function Thread_wait_1()
            while true do
                sleep(0.01)
            end
        end

        -- Start waiting if the states are no longer synchronized
        if getStandardDigitalOutput(DO_SYNC) ~= getStandardDigitalInput(DI_SYNC) then
            -- Directly call Thread_wait_1 (assuming no threading)
            Thread_wait_1() -- This will block indefinitely unless there's a condition to stop

            -- Check synchronization again
            while getStandardDigitalOutput(DO_SYNC) ~= getStandardDigitalInput(DI_SYNC) do
                sync()
            end
        end

    else
        -- If the outputs are not the same, synchronize them
        if getStandardDigitalOutput(DO_SYNC) ~= getStandardDigitalInput(DI_SYNC) then
            setStandardDigitalOutput(DO_SYNC, not getStandardDigitalOutput(DO_SYNC))
        end
    end
end

--
-- Example to move an external axis
function MoveAxis(value)
    -- use the value as an output:
    DO_AXIS_1 = 1
    DI_AXIS_1 = 1
    if value <= 0 then
        setStandardDigitalOutput(DO_AXIS_1, false)

        -- Wait for digital input to change state
        --while getStandardDigitalInput(DI_AXIS_1) ~= false do
        --  sync()
        --end
    else
        setStandardDigitalOutput(DO_AXIS_1, True)

        -- Wait for digital input to change state
        --while getStandardDigitalInput(DI_AXIS_1) ~= true do
        --  sync()
        --end
    end
end

--
-- Example weaving
function weave(type_var, step_var, amplitude_var, hold_distance_var, hold_time_var, angle_var, direction_var)
    -- Construct a JSON string with escaped backslashes
    local json_string =
        '{\"type\":\"' .. type_var .. '\",' ..
        '\"step\":' .. step_var .. ',' ..
        '\"amplitude\":[' .. table.concat(amplitude_var, ", ") .. '],' ..
        '\"hold_distance\":[' .. table.concat(hold_distance_var, ", ") .. '],' ..
        '\"hold_time\":[' .. table.concat(hold_time_var, ", ") .. '],' ..
        '\"angle\":' .. angle_var .. ',' ..
        '\"direction\":' .. direction_var .. '}'
    textmsg("weaveparam: "..json_string)
    -- Call the weaveStart function with the constructed and escaped JSON string
    weaveStart(json_string)
end
----------------------------
  
