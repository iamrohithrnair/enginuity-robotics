<?xml version="1.0" encoding="UTF-8"?>
<AuboProgram name="SetProg" installation="SetProg_ins" installationRelativePath="SetProg_ins.ins" directory="/root/arcs_ws/program" createdIn="0.29.3-rc.10" lastSaveIn="0.29.3-rc.10" robotSerialNumber="RoboDK" crcValue="225635">
    <kinematics status="NOT_INITIALIZED" validChecksum="false">
        <theta value="3.14159265358979,-1.5707963267949,0,-1.5707963267949,0,0"/>
        <a value="0.0010004,0,0.647,0.601445091,0.000451803,-0.000785351"/>
        <d value="0.1632,0.201467966,-0.000167966,0.000167966,0.10373501,0.094884533"/>
        <alpha value="0,-1.5703531067949,3.13960138358979,3.13793245358979,-1.5694211267949,1.5774796767949"/>
        <jointChecksum value="0,0,0,0,0,0"/>
    </kinematics>
    <WaypointModel>
        <Waypoint name="Waypoint_0">
            <RobotPose pose="0.426318, 0.020000, 0.422034, 3.141593, 0.872665, 3.141593"/>
            <JointPositions angles="0.000000, -0.174533, 0.349066, 0.000000, 0.523599, 0.000000"/>
            <TcpOffset pose="0.010000, 0.020000, 0.150000, 0.000000, 0.000000, 0.000000"/>
            <Kinematics status="NOT_INITIALIZED" validChecksum="false">
                <theta value="0,0,0,0,0,0"/>
                <a value="0,0,0,0,0,0"/>
                <d value="0,0,0,0,0,0"/>
                <alpha value="0,0,0,0,0,0"/>
                <beta value="0,0,0,0,0,0"/>
                <jointChecksum value="beta_value"/>
            </Kinematics>
        </Waypoint>
        <Waypoint name="Waypoint_1">
            <RobotPose pose="0.000000, -0.174533, 0.349066, 0.000000, 0.523599, 0.000000"/>
            <JointPositions angles="0.000000, -0.174533, 0.349066, 0.000000, 0.523599, 0.000000"/>
            <TcpOffset pose="0.010000, 0.020000, 0.150000, 0.000000, 0.000000, 0.000000"/>
            <Kinematics status="NOT_INITIALIZED" validChecksum="false">
                <theta value="0,0,0,0,0,0"/>
                <a value="0,0,0,0,0,0"/>
                <d value="0,0,0,0,0,0"/>
                <alpha value="0,0,0,0,0,0"/>
                <beta value="0,0,0,0,0,0"/>
                <jointChecksum value="beta_value"/>
            </Kinematics>
        </Waypoint>
        <Waypoint name="Waypoint_2">
            <RobotPose pose="0, 0, 0, 0, 0, 0"/>
            <JointPositions angles="0.349066, -0.174533, 0.349066, 0.000000, 0.523599, 0.000000"/>
            <TcpOffset pose="0.010000, 0.020000, 0.150000, 0.000000, 0.000000, 0.000000"/>
            <Kinematics status="NOT_INITIALIZED" validChecksum="false">
                <theta value="0,0,0,0,0,0"/>
                <a value="0,0,0,0,0,0"/>
                <d value="0,0,0,0,0,0"/>
                <alpha value="0,0,0,0,0,0"/>
                <beta value="0,0,0,0,0,0"/>
                <jointChecksum value="beta_value"/>
            </Kinematics>
        </Waypoint>
        <Waypoint name="Waypoint_3">
            <RobotPose pose="0.408367, 0.083800, 0.505120, -1.443581, 0.777846, -1.619927"/>
            <JointPositions angles="0.523599, -0.349066, 0.698132, 1.047198, -0.785398, -1.745329"/>
            <TcpOffset pose="0.010000, 0.020000, 0.150000, 0.000000, 0.000000, 0.000000"/>
            <Kinematics status="NOT_INITIALIZED" validChecksum="false">
                <theta value="0,0,0,0,0,0"/>
                <a value="0,0,0,0,0,0"/>
                <d value="0,0,0,0,0,0"/>
                <alpha value="0,0,0,0,0,0"/>
                <beta value="0,0,0,0,0,0"/>
                <jointChecksum value="beta_value"/>
            </Kinematics>
        </Waypoint>
    </WaypointModel>
    <TimerModel/>
    <VariableModel>
    </VariableModel>
    <SubProgModel/>
    <InitVariablesNode title="初始变量" id="247a8333-f7b0-47d2-8da8-056c3d15eef7">
        <datamodel/>
    </InitVariablesNode>
    <MainProgramNode title="机器人编程" id="1759edc3-72ae-4244-8b01-63c1cd9d2b7d">
        <datamodel>
            <Bool key="addBeforeStartSequence" value="false"/>
            <Bool key="loopForever" value="true"/>
        </datamodel>
        <children>
            <ScriptNode title="Func_lib.lua" id="bc8a3b76-d231-4536-b144-2c91074bfc45">
                <datamodel>
                    <Expression key="expression"/>
                    <String key="file_path" value="Func_lib.lua"/>
                    <Bool key="use_file" value="true"/>
                </datamodel>
            </ScriptNode>
        <SetNode title="Set No action" id="e443df78-9558-467f-9ba9-1faf7a024204">
            <datamodel>
                <Float64 key="aoValue" value="4"/>
                <Bool key="boolValue" value="false"/>
                <Int32 key="collisionLevel" value="-1"/>
                <Expression key="expression"/>
                <Float64 key="pulseTime" value="0.5"/>
                <Bool key="setTcp" value="true"/>
                <Bool key="syncProgramPointer" value="false"/>
                <TCP key="tcp" name="Tool S" id="23a7711a-8133-4876-b7eb-dcd9e87a1613"/>
                <String key="type" value="NO_ACTION"/>
            </datamodel>
        </SetNode>
        <MoveNode title="MoveJ" id="259f4329-e6f4-490b-9a16-4106cf6a659e">
            <datamodel>
                <Float64 key="blendRadius" value="0"/>
                <Feature key="feature" name="Base" id="12e0c8b2-bad6-40fb-9948-8dec4f65d4d9"/>
                <Float64 key="jointAcceleration" value="1.200"/>
                <Float64 key="jointSpeed" value="0.750"/>
                <Float64 key="toolAcceleration" value="1.2"/>
                <Float64 key="toolSpeed" value="0.25"/>
                <String key="type" value="MOVE_J"/>
                <Bool key="useActiveTCP" value="true"/>
                <Bool key="useJoints" value="false"/>
            </datamodel>
            <children>
                <WaypointNode title="Waypoint_0" id="b4862b21-fb97-4435-8856-1712e8e5216a">
                    <datamodel>
                        <VectorDouble key="baseToFeature" value="0,0,0,0,0,0"/>
                        <Float64 key="blendRadius" value="0.02"/>
                        <String key="blendType" value="NO_BLEND"/>
                        <Float64 key="cartesianAcceleration" value="1.2"/>
                        <Float64 key="cartesianSpeed" value="0.25"/>
                        <Float64 key="jointAcceleration" value="1.200000"/>
                        <Float64 key="jointSpeed" value="0.750000"/>
                        <Float64 key="motionTime" value="0"/>
                        <String key="motionType" value="SHARED"/>
                        <String key="type" value="POSITION"/>
                        <String key="variableType" value="VARIABLE_POSE"/>
                        <Waypoint key="waypoint" name="Waypoint_0"/>
                    </datamodel>
                </WaypointNode>
            </children>
        </MoveNode>
        <MoveNode title="MoveL" id="a3f2c9bf-9c63-46b9-90f2-44556f25e2a2">
            <datamodel>
                <Float64 key="blendRadius" value="0"/>
                <Feature key="feature" name="Base" id="8d723104-f773-43c1-b458-a748e9bb17bc"/>
                <Float64 key="jointAcceleration" value="1.3962634015954636"/>
                <Float64 key="jointSpeed" value="1.0471975511965976"/>
                <Float64 key="toolAcceleration" value="1.200"/>
                <Float64 key="toolSpeed" value="0.250"/>
                <String key="type" value="MOVE_L"/>
                <Bool key="useActiveTCP" value="true"/>
                <Bool key="useJoints" value="false"/>
            </datamodel>
            <children>
                <WaypointNode title="Waypoint_1" id="5a921187-19c7-4df4-8f4f-f31e78de5857">
                    <datamodel>
                        <VectorDouble key="baseToFeature" value="0,0,0,0,0,0"/>
                        <Float64 key="blendRadius" value="0.02"/>
                        <String key="blendType" value="NO_BLEND"/>
                        <Float64 key="cartesianAcceleration" value="1.2"/>
                        <Float64 key="cartesianSpeed" value="0.25"/>
                        <Float64 key="jointAcceleration" value="1.200000"/>
                        <Float64 key="jointSpeed" value="0.750000"/>
                        <Float64 key="motionTime" value="0"/>
                        <String key="motionType" value="SHARED"/>
                        <String key="type" value="POSITION"/>
                        <String key="variableType" value="VARIABLE_POSE"/>
                        <Waypoint key="waypoint" name="Waypoint_1"/>
                    </datamodel>
                </WaypointNode>
            </children>
        </MoveNode>
        <MoveNode title="MoveJ" id="17e0aa3c-0398-4ca8-aa7e-9d498c778ea6">
            <datamodel>
                <Float64 key="blendRadius" value="0.001000"/>
                <Feature key="feature" name="Base" id="b5d32b16-6619-4cb1-9710-37d1b83e90ec"/>
                <Float64 key="jointAcceleration" value="1.200"/>
                <Float64 key="jointSpeed" value="0.750"/>
                <Float64 key="toolAcceleration" value="1.2"/>
                <Float64 key="toolSpeed" value="0.25"/>
                <String key="type" value="MOVE_J"/>
                <Bool key="useActiveTCP" value="true"/>
                <Bool key="useJoints" value="true"/>
            </datamodel>
            <children>
                <WaypointNode title="Waypoint_2" id="eb2083e6-ce16-4dba-8ff1-8e0242af9fc3">
                    <datamodel>
                        <VectorDouble key="baseToFeature" value="0,0,0,0,0,0"/>
                        <Float64 key="blendRadius" value="0.001000"/>
                        <String key="blendType" value="WAYPOINT_BLEND"/>
                        <Float64 key="cartesianAcceleration" value="1.2"/>
                        <Float64 key="cartesianSpeed" value="0.25"/>
                        <Float64 key="jointAcceleration" value="1.200000"/>
                        <Float64 key="jointSpeed" value="0.750000"/>
                        <Float64 key="motionTime" value="0"/>
                        <String key="motionType" value="SHARED"/>
                        <String key="type" value="POSITION"/>
                        <String key="variableType" value="VARIABLE_POSE"/>
                        <Waypoint key="waypoint" name="Waypoint_2"/>
                    </datamodel>
                </WaypointNode>
            </children>
        </MoveNode>
        <WaitNode title="Wait: 0.25s" id="a0116be5-ab0c-4681-88f8-e3d0d3290a4c">
            <datamodel>
                <String key="compareOperator" value="LESS_THAN"/>
                <Bool key="di_value" value="false"/>
                <Expression key="expression"/>
                <Float32 key="floatValue" value="4"/>
                <Float64 key="timeout" value="0"/>
                <String key="type" value="TIME"/>
                <Float64 key="waitTime" value="0.25"/>
            </datamodel>
        </WaitNode>
        <MoveNode title="MoveJ" id="101fbccc-ded7-43e8-b421-eaeb534097ca">
            <datamodel>
                <Float64 key="blendRadius" value="0.001000"/>
                <Feature key="feature" name="Base" id="38c1962e-9148-424f-aac1-c14f30e9c5cc"/>
                <Float64 key="jointAcceleration" value="1.200"/>
                <Float64 key="jointSpeed" value="0.750"/>
                <Float64 key="toolAcceleration" value="1.2"/>
                <Float64 key="toolSpeed" value="0.25"/>
                <String key="type" value="MOVE_J"/>
                <Bool key="useActiveTCP" value="true"/>
                <Bool key="useJoints" value="false"/>
            </datamodel>
            <children>
                <WaypointNode title="Waypoint_3" id="baf3897a-3e70-416a-9548-5822de1b372a">
                    <datamodel>
                        <VectorDouble key="baseToFeature" value="0,0,0,0,0,0"/>
                        <Float64 key="blendRadius" value="0.001000"/>
                        <String key="blendType" value="WAYPOINT_BLEND"/>
                        <Float64 key="cartesianAcceleration" value="1.2"/>
                        <Float64 key="cartesianSpeed" value="0.25"/>
                        <Float64 key="jointAcceleration" value="1.200000"/>
                        <Float64 key="jointSpeed" value="0.750000"/>
                        <Float64 key="motionTime" value="0"/>
                        <String key="motionType" value="SHARED"/>
                        <String key="type" value="POSITION"/>
                        <String key="variableType" value="VARIABLE_POSE"/>
                        <Waypoint key="waypoint" name="Waypoint_3"/>
                    </datamodel>
                </WaypointNode>
            </children>
        </MoveNode>
        </children>
    </MainProgramNode>

</AuboProgram>