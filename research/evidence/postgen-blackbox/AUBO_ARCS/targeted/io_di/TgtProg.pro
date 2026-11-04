<?xml version="1.0" encoding="UTF-8"?>
<AuboProgram name="TgtProg" installation="TgtProg_ins" installationRelativePath="TgtProg_ins.ins" directory="/root/arcs_ws/program" createdIn="0.29.3-rc.10" lastSaveIn="0.29.3-rc.10" robotSerialNumber="RoboDK" crcValue="225635">
    <kinematics status="NOT_INITIALIZED" validChecksum="false">
        <theta value="3.14159265358979,-1.5707963267949,0,-1.5707963267949,0,0"/>
        <a value="0.0010004,0,0.647,0.601445091,0.000451803,-0.000785351"/>
        <d value="0.1632,0.201467966,-0.000167966,0.000167966,0.10373501,0.094884533"/>
        <alpha value="0,-1.5703531067949,3.13960138358979,3.13793245358979,-1.5694211267949,1.5774796767949"/>
        <jointChecksum value="0,0,0,0,0,0"/>
    </kinematics>
    <WaypointModel>
    </WaypointModel>
    <TimerModel/>
    <VariableModel>
    </VariableModel>
    <SubProgModel/>
    <InitVariablesNode title="初始变量" id="5a921187-19c7-4df4-8f4f-f31e78de5857">
        <datamodel/>
    </InitVariablesNode>
    <MainProgramNode title="机器人编程" id="a3f2c9bf-9c63-46b9-90f2-44556f25e2a2">
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
        <WaitNode title="Wait: DI00=High" id="f7c1bd87-4da5-4709-9471-3d60c8a70639">
            <datamodel>
                <String key="compareOperator" value="LESS_THAN"/>
                <Bool key="di_value" value="true"/>
                <Io key="digitalInput" name="DI00"/>
                <Expression key="expression"/>
                <Float32 key="floatValue" value="4"/>
                <Float64 key="timeout" value="0"/>
                <String key="type" value="DIGITAL_INPUT"/>
                <Float64 key="waitTime" value="0.01"/>
            </datamodel>
        </WaitNode>
        <WaitNode title="Wait: DI01=High" id="e443df78-9558-467f-9ba9-1faf7a024204">
            <datamodel>
                <String key="compareOperator" value="LESS_THAN"/>
                <Bool key="di_value" value="true"/>
                <Io key="digitalInput" name="DI01"/>
                <Expression key="expression"/>
                <Float32 key="floatValue" value="4"/>
                <Float64 key="timeout" value="0"/>
                <String key="type" value="DIGITAL_INPUT"/>
                <Float64 key="waitTime" value="0.01"/>
            </datamodel>
        </WaitNode>
        <WaitNode title="Wait: DI02=1" id="23a7711a-8133-4876-b7eb-dcd9e87a1613">
            <datamodel>
                <String key="compareOperator" value="LESS_THAN"/>
                <Bool key="di_value" value="1"/>
                <Io key="digitalInput" name="DI02"/>
                <Expression key="expression"/>
                <Float32 key="floatValue" value="4"/>
                <Float64 key="timeout" value="0"/>
                <String key="type" value="DIGITAL_INPUT"/>
                <Float64 key="waitTime" value="0.01"/>
            </datamodel>
        </WaitNode>
        <WaitNode title="Wait: DI03=Low" id="1846d424-c17c-4279-a3c6-612f48268673">
            <datamodel>
                <String key="compareOperator" value="LESS_THAN"/>
                <Bool key="di_value" value="false"/>
                <Io key="digitalInput" name="DI03"/>
                <Expression key="expression"/>
                <Float32 key="floatValue" value="4"/>
                <Float64 key="timeout" value="0.00"/>
                <String key="type" value="DIGITAL_INPUT"/>
                <Float64 key="waitTime" value="0.01"/>
            </datamodel>
        </WaitNode>
        <WaitNode title="Wait: DI04=High" id="fcbd04c3-4021-4ef7-8ca5-a5a19e4d6e3c">
            <datamodel>
                <String key="compareOperator" value="LESS_THAN"/>
                <Bool key="di_value" value="true"/>
                <Io key="digitalInput" name="DI04"/>
                <Expression key="expression"/>
                <Float32 key="floatValue" value="4"/>
                <Float64 key="timeout" value="0.50"/>
                <String key="type" value="DIGITAL_INPUT"/>
                <Float64 key="waitTime" value="0.01"/>
            </datamodel>
        </WaitNode>
        <WaitNode title="Wait: DI12=ON" id="b4862b21-fb97-4435-8856-1712e8e5216a">
            <datamodel>
                <String key="compareOperator" value="LESS_THAN"/>
                <Bool key="di_value" value="ON"/>
                <Io key="digitalInput" name="DI12"/>
                <Expression key="expression"/>
                <Float32 key="floatValue" value="4"/>
                <Float64 key="timeout" value="0"/>
                <String key="type" value="DIGITAL_INPUT"/>
                <Float64 key="waitTime" value="0.01"/>
            </datamodel>
        </WaitNode>
        <WaitNode title="Wait: DIName=High" id="259f4329-e6f4-490b-9a16-4106cf6a659e">
            <datamodel>
                <String key="compareOperator" value="LESS_THAN"/>
                <Bool key="di_value" value="true"/>
                <Io key="digitalInput" name="DIName"/>
                <Expression key="expression"/>
                <Float32 key="floatValue" value="4"/>
                <Float64 key="timeout" value="0"/>
                <String key="type" value="DIGITAL_INPUT"/>
                <Float64 key="waitTime" value="0.01"/>
            </datamodel>
        </WaitNode>
        <WaitNode title="Wait: DI6=Low" id="12e0c8b2-bad6-40fb-9948-8dec4f65d4d9">
            <datamodel>
                <String key="compareOperator" value="LESS_THAN"/>
                <Bool key="di_value" value="false"/>
                <Io key="digitalInput" name="DI6"/>
                <Expression key="expression"/>
                <Float32 key="floatValue" value="4"/>
                <Float64 key="timeout" value="0"/>
                <String key="type" value="DIGITAL_INPUT"/>
                <Float64 key="waitTime" value="0.01"/>
            </datamodel>
        </WaitNode>
        <WaitNode title="Wait: DI99=Low" id="5487ce1e-af19-422a-99b8-a714e61a441c">
            <datamodel>
                <String key="compareOperator" value="LESS_THAN"/>
                <Bool key="di_value" value="false"/>
                <Io key="digitalInput" name="DI99"/>
                <Expression key="expression"/>
                <Float32 key="floatValue" value="4"/>
                <Float64 key="timeout" value="0"/>
                <String key="type" value="DIGITAL_INPUT"/>
                <Float64 key="waitTime" value="0.01"/>
            </datamodel>
        </WaitNode>
        </children>
    </MainProgramNode>

</AuboProgram>